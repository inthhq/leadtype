/**
 * One normalizer, one resolved project.
 *
 * Takes a validated `DocsConfig` — authored in either the canonical vocabulary
 * or the older one — and produces two things:
 *
 *   1. A **canonical config**: the same object with deprecated aliases folded
 *      onto their replacements. Every downstream subsystem reads canonical
 *      names only, so none of them has to know the aliases exist.
 *   2. A **resolved config**: the project model — collections, the deduped
 *      source graph, and per-field provenance.
 *
 * Aliases are additive, never ambiguous. Setting a deprecated field and its
 * replacement together is an error naming both, rather than a silent
 * precedence rule a reader would have to look up.
 */

import { normalizeUrlPrefix, stripTrailingSlashes } from "../internal/docs-url";
import type { DocsCollection, DocsConfig, GitSourceSpec } from "../llm/llm";
import { isShaRef } from "../sync/sync";
import {
  type ConfigDeprecation,
  DEFAULT_COLLECTION_KEY,
  DEFAULT_SOURCE_ID,
  type FieldProvenance,
  type ResolvedDocsCollection,
  type ResolvedDocsConfig,
  type ResolvedGitSource,
  type ResolvedSource,
} from "./types";

/**
 * Deprecated collection fields and their canonical replacements. Only true
 * renames belong here — a convenience shorthand that coexists with a longer
 * form (`agents.mcp: true` beside `{ enabled: true }`) is not a deprecation.
 */
const COLLECTION_FIELD_ALIASES = [
  {
    id: "collection.prefix",
    deprecated: "prefix",
    canonical: "routePrefix",
    why: "the value is specifically a public route prefix",
  },
  {
    id: "collection.sourceConfig",
    deprecated: "sourceConfig",
    canonical: "inheritConfig",
    why: "the field declares inheritance from the source repo, not a config object",
  },
  {
    id: "collection.schema",
    deprecated: "schema",
    canonical: "frontmatterSchema",
    why: "it matches the top-level field of the same purpose",
  },
] as const satisfies readonly {
  id: string;
  deprecated: keyof DocsCollection;
  canonical: keyof DocsCollection;
  why: string;
}[];

export type NormalizeDocsConfigOptions = {
  /** Absolute path of the config file, used in provenance and errors. */
  configPath?: string;
  /** Directory relative paths resolve against. Defaults to the config's dir. */
  configDir?: string;
};

export type NormalizedDocsConfig = {
  /** The authored config with deprecated aliases folded onto canonical names. */
  config: DocsConfig;
  resolved: ResolvedDocsConfig;
};

function configLabel(configPath: string | undefined): string {
  return configPath ? `docs config at "${configPath}"` : "docs config";
}

/**
 * What applies when no `baseUrl` is authored anywhere — recorded in provenance
 * so doctor and `generate --explain` can say it instead of a reader having to
 * know `normalizeBaseUrl`'s fallback chain.
 */
export const BASE_URL_DEFAULT_SOURCE =
  "deployment URL env vars (NEXT_PUBLIC_SITE_URL, VERCEL_URL, …) or localhost";

/**
 * A `?` or `#` anywhere in the authored value. A bare trailing delimiter
 * (`https://acme.dev?`) parses with empty `search`/`hash`, so the parsed
 * components alone would pass it through into every joined URL.
 */
const QUERY_OR_FRAGMENT_DELIMITER_PATTERN = /[?#]/;

/**
 * Validate and normalize an authored base URL: an absolute http(s) origin
 * plus optional path prefix. The returned value is the parser's own
 * serialization with trailing slashes stripped, so URL joins can never
 * produce `//` and authored text WHATWG merely tolerates (`\` for `/` in
 * special schemes, unencoded spaces) comes back in normalized, encoded form
 * rather than passing through raw. `subject` names the value in errors
 * (`docs config …: baseUrl`, `--base-url`, `createDocsProject baseUrl`) so
 * every place a base URL is authored shares this one validator; the env
 * fallback chain in `normalizeBaseUrl` is not authored input and stays
 * outside it.
 */
export function normalizeAuthoredBaseUrl(
  baseUrl: string,
  subject: string
): string {
  const normalized = stripTrailingSlashes(baseUrl.trim());
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(
      `${subject} "${baseUrl}" is not an absolute URL. Use the site's public origin, optionally with a path prefix — e.g. "https://acme.dev" or "https://acme.dev/handbook".`
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    // Ordered above every rejection that echoes the authored value (protocol,
    // query/fragment): this one does not echo, because the whole point is
    // that it carries a secret, and error text lands in CI logs. `ftp:` is a
    // WHATWG special scheme, so `ftp://user:pass@host` parses with populated
    // userinfo and must hit this message, not the echoing protocol one. (The
    // parse failure above can echo safely — a value the parser cannot read
    // yielded no credentials to leak.) The serialized return would otherwise
    // copy the credentials into every public artifact URL joins feed —
    // sitemap, search metadata, feeds, agent files.
    throw new Error(
      `${subject} must not embed credentials (user:password@host) — the value is copied into publicly generated artifacts (sitemap, search metadata, feeds). Use the bare origin, optionally with a path prefix.`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${subject} "${baseUrl}" must be an http or https URL — generated links are joined onto it verbatim.`
    );
  }
  if (
    parsed.search ||
    parsed.hash ||
    QUERY_OR_FRAGMENT_DELIMITER_PATTERN.test(normalized)
  ) {
    throw new Error(
      `${subject} "${baseUrl}" must not carry a query or fragment — it is a prefix every generated URL joins onto.`
    );
  }
  // The serialized form, not the authored text: the parser has already
  // normalized what it tolerated (`https://acme.dev\api` parses with `\` as
  // `/`, a space stays raw in the input but is encoded in `href`), and
  // returning the raw string would carry those into every joined URL.
  return stripTrailingSlashes(parsed.href);
}

function normalizeConfigBaseUrl(
  baseUrl: string | undefined,
  configPath: string | undefined
): string | undefined {
  if (baseUrl === undefined) {
    return;
  }
  return normalizeAuthoredBaseUrl(
    baseUrl,
    `${configLabel(configPath)}: baseUrl`
  );
}

/** Carry the normalized `baseUrl` on the canonical config, when one exists. */
function foldBaseUrl(
  config: DocsConfig,
  baseUrl: string | undefined
): DocsConfig {
  return baseUrl === undefined || config.baseUrl === baseUrl
    ? config
    : { ...config, baseUrl };
}

/**
 * Fold one collection's deprecated aliases onto their canonical fields,
 * collecting a deprecation record for each. Throws when both spellings of the
 * same concept are set — precedence would be invisible at the call site.
 */
function applyCollectionAliases(
  key: string,
  collection: DocsCollection,
  configPath: string | undefined,
  deprecations: ConfigDeprecation[],
  provenance: Record<string, FieldProvenance>
): DocsCollection {
  const next: DocsCollection = { ...collection };

  for (const alias of COLLECTION_FIELD_ALIASES) {
    const authored = collection[alias.deprecated];
    const canonical = collection[alias.canonical];
    if (authored === undefined) {
      continue;
    }
    if (canonical !== undefined) {
      throw new Error(
        `${configLabel(configPath)}: collection "${key}" sets both "${alias.deprecated}" and "${alias.canonical}". Remove "${alias.deprecated}" — "${alias.canonical}" is the canonical field.`
      );
    }
    // The alias pair is same-typed by construction (see the satisfies clause
    // above), but TypeScript can't relate two dynamically-indexed keys of a
    // union, so the write goes through a record view.
    const mutable = next as Record<string, unknown>;
    mutable[alias.canonical] = authored;
    // The canonical config must not carry the alias forward — downstream code
    // reads canonical names only, and a leftover would be dead state a reader
    // might reasonably trust.
    delete mutable[alias.deprecated];
    deprecations.push({
      id: alias.id,
      field: `collections.${key}.${alias.deprecated}`,
      replacement: `collections.${key}.${alias.canonical}`,
      message: `collections.${key}.${alias.deprecated} is deprecated — rename it to ${alias.canonical}, because ${alias.why}.`,
    });
    provenance[alias.canonical] = {
      origin: "explicit",
      authoredAs: alias.deprecated,
      ...(configPath ? { configPath } : {}),
    };
  }

  return next;
}

function explicit(configPath: string | undefined): FieldProvenance {
  return { origin: "explicit", ...(configPath ? { configPath } : {}) };
}

function recordExplicit(
  provenance: Record<string, FieldProvenance>,
  field: string,
  value: unknown,
  configPath: string | undefined
): void {
  if (value !== undefined && provenance[field] === undefined) {
    provenance[field] = explicit(configPath);
  }
}

function resolveCollectionEntry(
  key: string,
  collection: DocsCollection,
  configPath: string | undefined,
  sourceId: string
): ResolvedDocsCollection {
  const provenance: Record<string, FieldProvenance> = {};
  for (const field of [
    "dir",
    "include",
    "exclude",
    "frontmatterSchema",
    "navigation",
    "groups",
    "mounts",
    "inheritConfig",
  ] as const) {
    recordExplicit(provenance, field, collection[field], configPath);
  }

  const routePrefix = collection.routePrefix ?? `/${key}`;
  if (collection.routePrefix === undefined) {
    provenance.routePrefix = {
      origin: "inferred",
      inferredFrom: "collection key",
      ...(configPath ? { configPath } : {}),
    };
  } else if (provenance.routePrefix === undefined) {
    provenance.routePrefix = explicit(configPath);
  }

  return {
    key,
    dir: collection.dir,
    routePrefix: normalizeUrlPrefix(routePrefix),
    ...(collection.include ? { include: collection.include } : {}),
    ...(collection.exclude ? { exclude: collection.exclude } : {}),
    ...(collection.frontmatterSchema
      ? { frontmatterSchema: collection.frontmatterSchema }
      : {}),
    ...(collection.navigation ? { navigation: collection.navigation } : {}),
    ...(collection.groups ? { groups: collection.groups } : {}),
    ...(collection.mounts ? { mounts: collection.mounts } : {}),
    ...(collection.inheritConfig === undefined
      ? {}
      : { inheritConfig: collection.inheritConfig }),
    sourceId,
    provenance,
  };
}

/**
 * Build the acquisition graph. Two collections pointing at the same
 * `(repository, ref)` share one git source — which is what sync already does
 * internally, now visible in the model. Conflicting `cacheDir` values for one
 * source are rejected here rather than at clone time.
 */
function resolveSources(
  collections: Record<string, DocsCollection>,
  configPath: string | undefined,
  /** Collection key → authored source name, for collections under a `gitSource`. */
  authoredSourceNames: ReadonlyMap<string, string> = new Map()
): { sources: ResolvedSource[]; sourceIdByCollection: Map<string, string> } {
  const sources: ResolvedSource[] = [];
  const gitByRepoRef = new Map<string, ResolvedGitSource>();
  const sourceIdByCollection = new Map<string, string>();
  const localKeys: string[] = [];
  // Which authored source name (if any) claimed each resolved acquisition, so
  // two named sources for one clone can be rejected rather than silently
  // merged under whichever name happened to come first.
  const authoredNameByRepoRef = new Map<string, string>();

  for (const [key, collection] of Object.entries(collections)) {
    if (!collection.repository) {
      localKeys.push(key);
      sourceIdByCollection.set(key, DEFAULT_SOURCE_ID);
      continue;
    }
    const ref = collection.ref ?? "main";
    const repoRefKey = `${collection.repository}#${ref}`;
    const authoredName = authoredSourceNames.get(key);
    const existing = gitByRepoRef.get(repoRefKey);
    if (existing) {
      if (
        collection.cacheDir !== undefined &&
        existing.cacheDir !== undefined &&
        collection.cacheDir !== existing.cacheDir
      ) {
        throw new Error(
          `${configLabel(configPath)}: collections [${existing.collectionKeys.join(", ")}] and "${key}" target ${collection.repository}@${ref} but set different cacheDir values ("${existing.cacheDir}" vs "${collection.cacheDir}"). Make them match or remove the explicit cacheDir.`
        );
      }
      const claimedBy = authoredNameByRepoRef.get(repoRefKey);
      if (authoredName && claimedBy && authoredName !== claimedBy) {
        throw new Error(
          `${configLabel(configPath)}: sources "${claimedBy}" and "${authoredName}" both target ${collection.repository}@${ref}. That is one acquisition declared twice — merge their collections into a single source.`
        );
      }
      // A flat collection reaches this loop before any named source (expansion
      // spreads the existing map in first), so without this the named source
      // silently loses its authored id and reports as `repo#ref` everywhere —
      // sync output, doctor, and `generate --json`.
      if (authoredName && !claimedBy) {
        authoredNameByRepoRef.set(repoRefKey, authoredName);
        existing.id = authoredName;
        for (const key of existing.collectionKeys) {
          sourceIdByCollection.set(key, authoredName);
        }
      }
      existing.cacheDir ??= collection.cacheDir;
      existing.collectionKeys.push(key);
      sourceIdByCollection.set(key, existing.id);
      continue;
    }
    // A named source keeps its authored id; an anonymous one is identified by
    // what it actually is. Either way the id is stable and appears verbatim in
    // human output, JSON output, and sync diagnostics.
    const source: ResolvedGitSource = {
      id: authoredName ?? repoRefKey,
      kind: "git",
      repository: collection.repository,
      ref,
      refKind: isShaRef(ref) ? "commit" : "mutable",
      ...(collection.cacheDir ? { cacheDir: collection.cacheDir } : {}),
      ...(collection.sparse && collection.sparse.length > 0
        ? { sparse: collection.sparse }
        : {}),
      collectionKeys: [key],
    };
    if (authoredName) {
      authoredNameByRepoRef.set(repoRefKey, authoredName);
    }
    gitByRepoRef.set(repoRefKey, source);
    sources.push(source);
    sourceIdByCollection.set(key, source.id);
  }

  if (localKeys.length > 0) {
    sources.unshift({
      id: DEFAULT_SOURCE_ID,
      kind: "local",
      collectionKeys: localKeys,
    });
  }

  return { sources, sourceIdByCollection };
}

const TOP_LEVEL_PROVENANCE_FIELDS = [
  "product",
  "organization",
  "llms",
  "frontmatterSchema",
  "transformers",
  "flatteners",
  "navigation",
  "groups",
  "mounts",
  "feeds",
  "collections",
  "sources",
  "openapi",
  "i18n",
  "git",
  "agents",
  "redirects",
  "lint",
] as const;

/**
 * Flatten `sources` into the collections map.
 *
 * A source group is pure sugar over the flat form: acquisition fields cascade
 * onto every child, and a child may override the source's inheritance policy
 * (including opting out with `false`). Collection ids stay flat and global
 * because they name staging mounts, error messages, and JSON output — a
 * silently namespaced id would show up in all three.
 */
function expandGitSources(
  sources: Record<string, GitSourceSpec>,
  existing: Record<string, DocsCollection>,
  configPath: string | undefined
): {
  collections: Record<string, DocsCollection>;
  sourceIdByCollection: Map<string, string>;
} {
  const collections: Record<string, DocsCollection> = { ...existing };
  const sourceIdByCollection = new Map<string, string>();
  const ownerOfKey = new Map<string, string>(
    Object.keys(existing).map((key) => [key, "collections"])
  );

  for (const [sourceId, source] of Object.entries(sources)) {
    if (Object.keys(source.collections).length === 0) {
      throw new Error(
        `${configLabel(configPath)}: source "${sourceId}" declares no collections. A source exists to be read from — remove it or add one.`
      );
    }
    for (const [key, child] of Object.entries(source.collections)) {
      const owner = ownerOfKey.get(key);
      if (owner) {
        throw new Error(
          `${configLabel(configPath)}: collection id "${key}" is declared by both ${owner === "collections" ? '"collections"' : `source "${owner}"`} and source "${sourceId}". Collection ids are global — rename one.`
        );
      }
      ownerOfKey.set(key, sourceId);
      sourceIdByCollection.set(key, sourceId);
      // A child's own policy wins, including `false` to opt out of a
      // source-level default — hence comparing against undefined rather than
      // relying on falsiness.
      const inheritConfig =
        child.inheritConfig === undefined
          ? source.inheritConfig
          : child.inheritConfig;
      collections[key] = {
        ...child,
        repository: source.repository,
        ...(source.ref === undefined ? {} : { ref: source.ref }),
        ...(source.cacheDir === undefined ? {} : { cacheDir: source.cacheDir }),
        ...(source.sparse === undefined ? {} : { sparse: source.sparse }),
        ...(inheritConfig === undefined ? {} : { inheritConfig }),
      };
    }
  }

  return { collections, sourceIdByCollection };
}

export function normalizeDocsConfig(
  config: DocsConfig,
  options: NormalizeDocsConfigOptions = {}
): NormalizedDocsConfig {
  const { configPath } = options;
  const deprecations: ConfigDeprecation[] = [];
  const provenance: Record<string, FieldProvenance> = {};

  for (const field of TOP_LEVEL_PROVENANCE_FIELDS) {
    recordExplicit(provenance, field, config[field], configPath);
  }

  // `baseUrl` always gets a provenance entry, authored or not: it is the one
  // value with an env-var fallback chain, so "where would it come from?" has
  // an answer even when nothing was written down.
  const baseUrl = normalizeConfigBaseUrl(config.baseUrl, configPath);
  provenance.baseUrl =
    config.baseUrl === undefined
      ? { origin: "default", inferredFrom: BASE_URL_DEFAULT_SOURCE }
      : explicit(configPath);

  if (!(config.collections || config.sources)) {
    // Single-source: the content root comes from the host (`--docs-dir` for the
    // CLI, `contentDir` for the runtime source), so the resolved collection
    // carries no `dir`. Everything else about it is authored at the top level.
    const collectionProvenance: Record<string, FieldProvenance> = {};
    for (const field of [
      "frontmatterSchema",
      "navigation",
      "groups",
      "mounts",
    ] as const) {
      recordExplicit(collectionProvenance, field, config[field], configPath);
    }
    collectionProvenance.dir = {
      origin: "default",
      inferredFrom: "host content root (--docs-dir / contentDir)",
    };
    collectionProvenance.routePrefix = {
      origin: "default",
      inferredFrom: "single-source default",
    };

    return {
      config: foldBaseUrl(config, baseUrl),
      resolved: {
        mode: "single-source",
        ...(configPath ? { configPath } : {}),
        ...(options.configDir ? { configDir: options.configDir } : {}),
        product: config.product,
        ...(baseUrl === undefined ? {} : { baseUrl }),
        collections: [
          {
            key: DEFAULT_COLLECTION_KEY,
            routePrefix: "/docs",
            ...(config.frontmatterSchema
              ? { frontmatterSchema: config.frontmatterSchema }
              : {}),
            ...(config.navigation ? { navigation: config.navigation } : {}),
            ...(config.groups ? { groups: config.groups } : {}),
            ...(config.mounts ? { mounts: config.mounts } : {}),
            sourceId: DEFAULT_SOURCE_ID,
            provenance: collectionProvenance,
          },
        ],
        sources: [
          {
            id: DEFAULT_SOURCE_ID,
            kind: "local",
            collectionKeys: [DEFAULT_COLLECTION_KEY],
          },
        ],
        deprecations,
        provenance,
      },
    };
  }

  // Source groups are sugar over the flat map: expand first, then everything
  // downstream sees one collections map regardless of how it was authored.
  const {
    collections: flatCollections,
    sourceIdByCollection: authoredSourceNames,
  } = expandGitSources(
    config.sources ?? {},
    config.collections ?? {},
    configPath
  );

  const canonicalCollections: Record<string, DocsCollection> = {};
  const aliasProvenance = new Map<string, Record<string, FieldProvenance>>();
  for (const [key, collection] of Object.entries(flatCollections)) {
    const collectionAliasProvenance: Record<string, FieldProvenance> = {};
    canonicalCollections[key] = applyCollectionAliases(
      key,
      collection,
      configPath,
      deprecations,
      collectionAliasProvenance
    );
    aliasProvenance.set(key, collectionAliasProvenance);
  }

  const { sources, sourceIdByCollection } = resolveSources(
    canonicalCollections,
    configPath,
    authoredSourceNames
  );

  const collections = Object.entries(canonicalCollections).map(
    ([key, collection]) => {
      const entry = resolveCollectionEntry(
        key,
        collection,
        configPath,
        sourceIdByCollection.get(key) ?? DEFAULT_SOURCE_ID
      );
      // Alias provenance wins: it knows the field was authored under its old
      // name, which is what a migration diagnostic needs to report.
      return {
        ...entry,
        provenance: {
          ...entry.provenance,
          ...(aliasProvenance.get(key) ?? {}),
        },
      };
    }
  );

  assertUniqueRoutePrefixes(collections, configPath);

  // `sources` is dropped from the canonical config: its collections are now in
  // the flat map, and leaving both would let a consumer read the project twice.
  const { sources: _authoredSources, ...withoutSources } = config;
  return {
    config: foldBaseUrl(
      { ...withoutSources, collections: canonicalCollections },
      baseUrl
    ),
    resolved: {
      mode: "multi-source",
      ...(configPath ? { configPath } : {}),
      ...(options.configDir ? { configDir: options.configDir } : {}),
      product: config.product,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      collections,
      sources,
      deprecations,
      provenance,
    },
  };
}

function assertUniqueRoutePrefixes(
  collections: ResolvedDocsCollection[],
  configPath: string | undefined
): void {
  const byPrefix = new Map<string, string>();
  for (const collection of collections) {
    if (collection.routePrefix === "/") {
      throw new Error(
        `${configLabel(configPath)}: collection "${collection.key}" routePrefix must not be the site root.`
      );
    }
    const owner = byPrefix.get(collection.routePrefix);
    if (owner) {
      throw new Error(
        `${configLabel(configPath)}: collections "${owner}" and "${collection.key}" share routePrefix "${collection.routePrefix}". Give each collection a distinct public prefix.`
      );
    }
    byPrefix.set(collection.routePrefix, collection.key);
  }
}

/**
 * One actionable warning per config load, listing every deprecated field with
 * its replacement. Emitted once by CLI flows — repeating it per subsystem would
 * bury the rest of the output.
 */
export function formatDeprecationWarning(
  deprecations: ConfigDeprecation[]
): { message: string; hint: string } | null {
  if (deprecations.length === 0) {
    return null;
  }
  const renames = deprecations
    .map((entry) => `${entry.field} → ${entry.replacement}`)
    .join(", ");
  return {
    message: `docs config uses ${deprecations.length} deprecated field${deprecations.length === 1 ? "" : "s"}: ${renames}`,
    hint: "These still work and will keep working until the next major release. Rename them to silence this warning.",
  };
}
