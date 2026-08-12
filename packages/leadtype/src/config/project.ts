/**
 * `resolveProject()` — the whole pipeline, once.
 *
 * Answering "what is this project?" takes five ordered steps: discover the
 * config, apply source-owned inheritance, normalize to canonical names, derive
 * what wasn't authored, and resolve each collection's content directory
 * through the sync cache. Every command needs all five.
 *
 * They used to each assemble those steps by hand, and the cost showed up
 * exactly where you'd predict: `doctor` and `nav` shipped with the *same two*
 * bugs — both skipped inheritance, so a project whose navigation lives in its
 * source repo reported as "inferred"; and both resolved a remote collection's
 * `dir` against the config directory instead of its checkout, so every page
 * went missing. Two commands, written days apart, same two omissions.
 *
 * So the pipeline is one function and the commands read its result.
 *
 * It is **non-throwing for environmental problems**. An unsynced source, a
 * missing directory, an unreadable source config — those are diagnostics on
 * the returned project, because `doctor` has to report them while `generate`
 * has to fail on them, and only the caller knows which. Genuinely malformed
 * config still throws: there is no project to describe.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { glob as fg } from "tinyglobby";
import {
  normalizeDocsSourceInput,
  parseDocsSourceInput,
} from "../internal/docs-source";
import { normalizeDocsPath, normalizeUrlPrefix } from "../internal/docs-url";
import type { DocsCollection, DocsConfig, DocsNavEntry } from "../llm";
import {
  formatSparse,
  readSyncManifest,
  resolveCollection,
  sameSparse,
} from "../sync/sync";
import {
  emptyInferenceReport,
  type InferenceReport,
  inferNavigationFromContent,
  mergeInferenceReports,
} from "./infer";
import { inheritCollectionSourceConfigs } from "./inherit";
import {
  type ConfigWarningSink,
  type LoadedDocsConfig,
  loadDocsConfig,
} from "./load";
import { normalizeDocsConfig } from "./normalize";
import {
  DEFAULT_COLLECTION_KEY,
  DEFAULT_SOURCE_ID,
  type FieldProvenance,
  type ResolvedDocsCollection,
  type ResolvedDocsConfig,
  type ResolvedSource,
} from "./types";

/** Where a collection's navigation tree came from. */
export type NavigationOrigin =
  /** Authored on this collection. */
  | "explicit"
  /** Inherited from the source repository's own docs config. */
  | "inherited"
  /** Derived from `group:` frontmatter via the legacy taxonomy. */
  | "groups"
  /** Derived from the content tree because nothing was authored. */
  | "inferred";

/**
 * Something that stopped a step from completing. Not an exception: a read-only
 * command reports these, a build command fails on them.
 */
export type ProjectDiagnostic = {
  /** Stable id, shared with `leadtype doctor` findings. */
  id: string;
  level: "error" | "warn";
  message: string;
  /** Collection id this concerns, when it concerns one. */
  collection?: string;
  /** Canonical config field or file that owns it. */
  owner?: string;
  /** A concrete next command. */
  fix?: string;
};

export type ResolvedProjectCollection = ResolvedDocsCollection & {
  /**
   * Absolute directory holding this collection's MDX, resolved through the
   * sync cache for remote collections. Absent when it could not be resolved —
   * see the matching diagnostic.
   */
  contentDir?: string;
  /** The navigation tree this collection will actually render. */
  navigation?: DocsNavEntry[];
  navigationOrigin: NavigationOrigin;
};

export type ResolvedProject = {
  /** Project root — what `--src` names, and what relative output paths mean. */
  rootDir: string;
  /** Directory holding the config file; relative config paths resolve here. */
  configDir: string;
  /**
   * Absolute path of the config file. Absent when there is no config, and
   * also when the caller supplied an in-memory config without naming its
   * file — a path that names nothing on disk would be worse than none.
   */
  configPath?: string;
  /**
   * How the config arrived: discovered as a `file` on disk, or supplied
   * in-memory by the `caller`. Absent when there is no config at all.
   */
  configOrigin?: "file" | "caller";
  /** The authored config: canonical names, inheritance applied. */
  config: LoadedDocsConfig["config"] | null;
  /** The normalized project model, with provenance. */
  resolved: ResolvedDocsConfig | null;
  collections: ResolvedProjectCollection[];
  sources: ResolvedSource[];
  /** What was derived rather than authored. */
  inference: InferenceReport;
  diagnostics: ProjectDiagnostic[];
};

export type ResolveProjectOptions = {
  /** Project root. Defaults to the current directory. */
  cwd?: string;
  /**
   * Use this config instead of discovering one. For callers that already hold
   * it — an app importing its own config module, say.
   */
  config?: DocsConfig;
  /**
   * Path the supplied `config` came from. Fixes where its relative paths
   * resolve and, for a `docs.config.*`, where the content root is.
   */
  configPath?: string;
  /**
   * Docs directories relative to `cwd`, for a single-source project whose
   * content root the config does not state. Defaults to `["docs"]`.
   */
  docsDirs?: string[];
  /**
   * Content root for a single-source project, overriding `docsDirs`. Absolute,
   * or relative to `cwd`.
   */
  contentDir?: string;
  /**
   * Apply source-owned config inheritance. Default `true`. Turning it off is
   * for callers that deliberately want the project as authored here.
   */
  inherit?: boolean;
  /**
   * Derive navigation from the content tree when nothing was authored.
   * Default `true`.
   */
  infer?: boolean;
  /**
   * Where load-time warnings (deprecations, unknown keys) go. Defaults to the
   * process-wide logger; commands with injected io pass their own stderr so
   * warnings never bypass it.
   */
  warn?: ConfigWarningSink;
};

const DEFAULT_DOCS_DIRNAME = "docs";

/**
 * Resolve one collection's content directory without touching the network.
 *
 * A remote collection's `dir` is relative to its **checkout**, not the config
 * directory — the single most repeated bug in the commands this replaces. For
 * remotes it also verifies the cache holds the revision the config asks for: a
 * checkout at the wrong ref renders stale content that looks entirely fine.
 */
async function resolveContentDir(
  collection: ResolvedDocsCollection,
  config: DocsConfig,
  configDir: string,
  fallbackDir: string,
  diagnostics: ProjectDiagnostic[]
): Promise<string | undefined> {
  const authored = config.collections?.[collection.key];
  if (!authored) {
    // Single-source: the host supplies the content root.
    if (existsSync(fallbackDir)) {
      return fallbackDir;
    }
    diagnostics.push({
      id: "source.dir-missing",
      level: "error",
      message: `docs directory "${fallbackDir}" does not exist`,
      collection: collection.key,
      owner: "--docs-dir",
    });
    return;
  }

  const resolvedCollection = resolveCollection(
    collection.key,
    authored,
    configDir
  );

  if (resolvedCollection.remote) {
    const { repository, ref, cacheDir } = resolvedCollection.remote;
    if (!existsSync(path.join(cacheDir, ".git"))) {
      diagnostics.push({
        id: "source.not-synced",
        level: "error",
        message: `collection "${collection.key}" reads ${repository}@${ref}, which has no checkout at "${cacheDir}"`,
        collection: collection.key,
        owner: `collections.${collection.key}.repository`,
        fix: "leadtype sync",
      });
      return;
    }
    const manifest = await readSyncManifest(cacheDir);
    if (!manifest) {
      diagnostics.push({
        id: "source.cache-unverifiable",
        level: "error",
        message: `the cache for collection "${collection.key}" at "${cacheDir}" has no sync manifest, so its revision can't be verified`,
        collection: collection.key,
        owner: `collections.${collection.key}.cacheDir`,
        fix: "leadtype sync --refresh",
      });
      return;
    }
    // A manifest without `sparse` records a full clone — a superset of any
    // sparse path set, so every configured path is present and there is
    // nothing "narrow" to reject. Only a checkout that was itself sparse can
    // be missing paths the config asks for.
    if (
      manifest.sparse !== undefined &&
      !sameSparse(manifest.sparse, resolvedCollection.remote.sparse)
    ) {
      diagnostics.push({
        id: "source.cache-narrow",
        level: "error",
        message: `the cache for collection "${collection.key}" was checked out with ${formatSparse(manifest.sparse)}, but the config asks for ${formatSparse(resolvedCollection.remote.sparse)}`,
        collection: collection.key,
        owner: `collections.${collection.key}.sparse`,
        fix: "leadtype sync --refresh",
      });
      return;
    }
    if (manifest.repository !== repository || manifest.ref !== ref) {
      diagnostics.push({
        id: "source.cache-stale",
        level: "error",
        message: `the cache for collection "${collection.key}" holds ${manifest.repository}@${manifest.ref}, but the config asks for ${repository}@${ref}`,
        collection: collection.key,
        owner: `collections.${collection.key}.ref`,
        fix: "leadtype sync --refresh",
      });
      return;
    }
  }

  if (!existsSync(resolvedCollection.absoluteDir)) {
    diagnostics.push({
      id: "source.dir-missing",
      level: "error",
      message: `collection "${collection.key}" points at "${resolvedCollection.absoluteDir}", which does not exist`,
      collection: collection.key,
      owner: `collections.${collection.key}.dir`,
    });
    return;
  }
  return resolvedCollection.absoluteDir;
}

function emptyProject(
  rootDir: string,
  diagnostics: ProjectDiagnostic[]
): ResolvedProject {
  return {
    rootDir,
    configDir: rootDir,
    config: null,
    resolved: null,
    collections: [],
    sources: [],
    inference: emptyInferenceReport(),
    diagnostics,
  };
}

/** One parsed `--docs-dir` value: the directory, and its explicit prefix. */
type DocsDirInput = { dir: string; urlPrefix?: string };

/**
 * The collections `generate`'s legacy multi-dir path stages for every
 * `--docs-dir` beyond the first: each mounts under its folder name
 * (`/docs/<basename>`) unless the value's `=<url-prefix>` names a mount
 * explicitly. The mount collision rule (and its message) matches `generate`.
 */
async function synthesizeExtraDirCollections(input: {
  rootDir: string;
  docsDirInputs: DocsDirInput[];
  docsDirs: string[];
  usedKeys: Set<string>;
  sourceId: string;
  infer: boolean;
  diagnostics: ProjectDiagnostic[];
}): Promise<{
  collections: ResolvedProjectCollection[];
  keys: string[];
  inference: InferenceReport;
}> {
  const { rootDir, docsDirInputs, docsDirs, usedKeys, sourceId, diagnostics } =
    input;
  const collections: ResolvedProjectCollection[] = [];
  const keys: string[] = [];
  let inference = emptyInferenceReport();
  const mountPaths = new Set<string>();
  for (const [index, entry] of docsDirInputs.entries()) {
    if (index === 0) {
      continue;
    }
    const absoluteDir = docsDirs[index] ?? path.resolve(rootDir, entry.dir);
    const mountPath = normalizeDocsPath(
      path.basename(entry.dir || absoluteDir)
    );
    const mountKey = mountPath.toLowerCase();
    if (mountPaths.has(mountKey)) {
      throw new Error(
        `Multiple docs sources resolve to the same mount path "${mountPath}". Use distinct source folder names.`
      );
    }
    mountPaths.add(mountKey);
    // Distinct mount paths can still collide with the primary collection's
    // key (a second dir literally named "docs"); suffix those.
    const key = usedKeys.has(mountPath) ? `${mountPath}-${index}` : mountPath;
    usedKeys.add(key);
    keys.push(key);

    const exists = existsSync(absoluteDir);
    if (!exists) {
      diagnostics.push({
        id: "source.dir-missing",
        level: "error",
        message: `docs directory "${absoluteDir}" does not exist`,
        collection: key,
        owner: "--docs-dir",
      });
    }
    let navigation: DocsNavEntry[] | undefined;
    if (input.infer && exists) {
      const derived = await inferNavigationFromContent(absoluteDir);
      navigation = derived.navigation;
      inference = mergeInferenceReports(inference, derived.report);
    }
    collections.push({
      key,
      routePrefix: entry.urlPrefix ?? normalizeUrlPrefix(`/docs/${mountPath}`),
      sourceId,
      provenance: {
        dir: {
          origin: "default",
          inferredFrom: "host content root (--docs-dir)",
        },
        routePrefix: entry.urlPrefix
          ? { origin: "explicit" }
          : {
              origin: "default",
              inferredFrom: "docs dir folder name",
            },
      },
      ...(exists ? { contentDir: absoluteDir } : {}),
      ...(navigation ? { navigation } : {}),
      navigationOrigin: "inferred",
    });
  }
  return { collections, keys, inference };
}

/**
 * The project `generate` builds when no config exists — a supported fallback:
 * the first `--docs-dir` mounts at the docs root (or its explicit
 * `=<url-prefix>`), each further one under its folder name. Returning an
 * empty project here made `doctor` and `nav` report no collections, routes,
 * or pages for a build that stages all of them — and exit 0, since the
 * missing config is only a warning.
 */
async function resolveConfiglessProject(input: {
  rootDir: string;
  docsDirInputs: DocsDirInput[];
  docsDirs: string[];
  diagnostics: ProjectDiagnostic[];
  options: ResolveProjectOptions;
}): Promise<ResolvedProject> {
  const { rootDir, docsDirInputs, docsDirs, diagnostics, options } = input;
  const infer = options.infer !== false;
  let inference = emptyInferenceReport();

  const primaryDir = path.resolve(
    options.contentDir ??
      docsDirs[0] ??
      path.join(rootDir, DEFAULT_DOCS_DIRNAME)
  );
  // `contentDir` overrides `docsDirs` entirely, prefixes included.
  const primaryPrefix = options.contentDir
    ? undefined
    : docsDirInputs[0]?.urlPrefix;
  const primaryExists = existsSync(primaryDir);
  if (!primaryExists) {
    diagnostics.push({
      id: "source.dir-missing",
      level: "error",
      message: `docs directory "${primaryDir}" does not exist`,
      collection: DEFAULT_COLLECTION_KEY,
      owner: "--docs-dir",
    });
  }
  let navigation: DocsNavEntry[] | undefined;
  if (infer && primaryExists) {
    const derived = await inferNavigationFromContent(primaryDir);
    navigation = derived.navigation;
    inference = mergeInferenceReports(inference, derived.report);
  }
  const collections: ResolvedProjectCollection[] = [
    {
      key: DEFAULT_COLLECTION_KEY,
      routePrefix: primaryPrefix ?? "/docs",
      sourceId: DEFAULT_SOURCE_ID,
      provenance: {
        dir: {
          origin: "default",
          inferredFrom: "host content root (--docs-dir)",
        },
        routePrefix: primaryPrefix
          ? { origin: "explicit" }
          : { origin: "default", inferredFrom: "single-source default" },
      },
      ...(primaryExists ? { contentDir: primaryDir } : {}),
      ...(navigation ? { navigation } : {}),
      navigationOrigin: "inferred",
    },
  ];
  const keys = [DEFAULT_COLLECTION_KEY];
  if (!options.contentDir && docsDirs.length > 1) {
    const extras = await synthesizeExtraDirCollections({
      rootDir,
      docsDirInputs,
      docsDirs,
      usedKeys: new Set(keys),
      sourceId: DEFAULT_SOURCE_ID,
      infer,
      diagnostics,
    });
    collections.push(...extras.collections);
    keys.push(...extras.keys);
    inference = mergeInferenceReports(inference, extras.inference);
  }

  return {
    rootDir,
    configDir: rootDir,
    config: null,
    resolved: null,
    collections,
    sources: [{ id: DEFAULT_SOURCE_ID, kind: "local", collectionKeys: keys }],
    inference,
    diagnostics,
  };
}

/**
 * Re-label fields a collection took from its source repository. Normalization
 * cannot tell the difference — by the time it runs, an inherited value is just
 * a value on the collection — so the caller stamps it after the fact.
 */
function stampInherited(
  provenance: Record<string, FieldProvenance>,
  fields: Set<string> | undefined,
  collectionKey: string
): Record<string, FieldProvenance> {
  if (!fields || fields.size === 0) {
    return provenance;
  }
  const stamped = { ...provenance };
  for (const field of fields) {
    stamped[field] = { origin: "inherited", inheritedFrom: collectionKey };
  }
  return stamped;
}

/**
 * The project root implied by a config file's location. A `docs.config.*` sits
 * inside the docs directory, so the root is its parent; a `leadtype.config.*`
 * sits at the root already.
 */
function projectRootForConfig(configPath: string): string {
  const configDir = path.dirname(configPath);
  return path.basename(configPath).startsWith("docs.config.")
    ? path.dirname(configDir)
    : configDir;
}

/**
 * The include/exclude selection of a collection, as a docs-relative membership
 * test for `inferNavigationFromContent` and `resolveCollectionNavigation`.
 * Empty (no filter) when the collection has no path filters. Uses the staging
 * glob semantics (`copySourceFiles`): dotfiles count, bare-directory entries
 * stay literal.
 */
export async function derivationPathFilter(
  collection: Pick<ResolvedDocsCollection, "include" | "exclude">,
  contentDir: string
): Promise<{ filter?: (relativePath: string) => boolean }> {
  const include = collection.include ?? [];
  const exclude = collection.exclude ?? [];
  if (include.length === 0 && exclude.length === 0) {
    return {};
  }
  const files = await fg(include.length > 0 ? include : ["**/*.{md,mdx}"], {
    absolute: false,
    cwd: contentDir,
    dot: true,
    expandDirectories: false,
    ignore: exclude,
    onlyFiles: true,
  });
  const allowed = new Set(files.map((file) => file.split(path.sep).join("/")));
  return { filter: (relativePath) => allowed.has(relativePath) };
}

export async function resolveProject(
  options: ResolveProjectOptions = {}
): Promise<ResolvedProject> {
  // A `docs.config.*` sits inside the docs directory, so the project root is
  // its parent; a `leadtype.config.*` sits at the root already. Deriving the
  // root from the basename keeps an explicit `configPath` on the same rule
  // discovery follows.
  const rootFromConfigPath = options.configPath
    ? projectRootForConfig(options.configPath)
    : undefined;
  const rootDir = path.resolve(
    options.cwd ?? rootFromConfigPath ?? process.cwd()
  );
  const docsDirNames =
    options.docsDirs && options.docsDirs.length > 0
      ? options.docsDirs
      : [DEFAULT_DOCS_DIRNAME];
  // Each `--docs-dir` value is `<dir>` or `<dir>=<url-prefix>` — the same
  // grammar `generate` reads, parsed by the same function, so the directory is
  // always the part before `=`. A malformed value (`<dir>=`, a prefix
  // normalizing to `/`) throws generate's error rather than resolving as a
  // path that cannot exist.
  const docsDirInputs = docsDirNames.map((value) => {
    const { docsDir, urlPrefix } = parseDocsSourceInput(value);
    return {
      dir: normalizeDocsSourceInput(docsDir),
      ...(urlPrefix ? { urlPrefix: normalizeUrlPrefix(urlPrefix) } : {}),
    };
  });
  const docsDirs = docsDirInputs.map((entry) =>
    path.resolve(rootDir, entry.dir)
  );
  const diagnostics: ProjectDiagnostic[] = [];

  // A caller that already holds the config skips discovery; it still goes
  // through normalization so the resolved model is identical either way. An
  // in-memory config without a `configPath` has no file, and gets no path —
  // fabricating one (the old behavior) made doctor-style consumers report a
  // config file that does not exist.
  const loaded: (Omit<LoadedDocsConfig, "path"> & { path?: string }) | null =
    options.config
      ? {
          ...normalizeDocsConfig(options.config, {
            ...(options.configPath ? { configPath: options.configPath } : {}),
            configDir: options.configPath
              ? path.dirname(options.configPath)
              : rootDir,
          }),
          ...(options.configPath ? { path: options.configPath } : {}),
        }
      : await loadDocsConfig({
          cwd: rootDir,
          docsDirs,
          ...(options.warn ? { warn: options.warn } : {}),
        });
  if (!loaded) {
    diagnostics.push({
      id: "config.missing",
      level: "warn",
      message: `no leadtype.config.* at "${rootDir}" and no docs.config.* in ${docsDirInputs.map((entry) => entry.dir).join(", ")}`,
      fix: "leadtype init",
    });
    // With no config *and* no content anywhere, there is no project to
    // describe — the warning (and its `leadtype init` fix) is the whole
    // answer. With content, `generate` builds it, so it must resolve here.
    const contentRoots = options.contentDir
      ? [path.resolve(options.contentDir)]
      : docsDirs;
    if (!contentRoots.some((dir) => existsSync(dir))) {
      return emptyProject(rootDir, diagnostics);
    }
    return await resolveConfiglessProject({
      rootDir,
      docsDirInputs,
      docsDirs,
      diagnostics,
      options,
    });
  }
  const configOrigin: "file" | "caller" = options.config ? "caller" : "file";

  // Unknown keys the validator warned about (discovery path only — a
  // caller-supplied config is typed, so its unknown keys were already
  // rejected by the compiler or are deliberate).
  for (const warning of loaded.warnings ?? []) {
    diagnostics.push({
      id: warning.id,
      level: "warn",
      message: warning.message,
      owner: warning.owner,
      ...(warning.fix ? { fix: warning.fix } : {}),
    });
  }

  const configDir = loaded.path ? path.dirname(loaded.path) : rootDir;

  // Inheritance first: it changes what the collections *are*, so normalizing
  // before it would describe a project that never runs.
  let config = loaded.config;
  const inheritedNavigation = new Set<string>();
  const inheritedFields = new Map<string, Set<string>>();
  const declared = loaded.config.collections;
  if (
    options.inherit !== false &&
    declared &&
    Object.values(declared).some((entry) => entry.inheritConfig)
  ) {
    // Per collection, not all at once. `inheritCollectionSourceConfigs` throws
    // on the first unreadable source config, so inheriting the whole map in one
    // call meant one unsynced collection silently degraded every other
    // collection's tree to a filesystem-derived one.
    const merged: Record<string, DocsCollection> = { ...declared };
    // Which fields each collection actually took from its source repo, so
    // provenance can say `inherited` rather than `explicit` — otherwise one
    // report claims a tree is inherited and that the same field was authored
    // here.
    const INHERITABLE = [
      "navigation",
      "groups",
      "frontmatterSchema",
      "flatteners",
      "mounts",
    ] as const;
    for (const [key, collection] of Object.entries(declared)) {
      if (!collection.inheritConfig) {
        continue;
      }
      try {
        const inherited = await inheritCollectionSourceConfigs(
          { [key]: collection },
          configDir
        );
        const next = inherited[key];
        if (!next) {
          continue;
        }
        merged[key] = next;
        const fields = new Set<string>();
        for (const field of INHERITABLE) {
          if (next[field] !== undefined && collection[field] === undefined) {
            fields.add(field);
          }
        }
        if (fields.size > 0) {
          inheritedFields.set(key, fields);
        }
        if (fields.has("navigation")) {
          inheritedNavigation.add(key);
        }
      } catch (error) {
        // `inheritConfig` is opt-in and unsatisfiable here, which `generate`
        // treats as fatal — so this is an error, not a warning, or CI gating
        // on doctor would pass a project the build then fails on.
        diagnostics.push({
          id: "source.inherit-failed",
          level: "error",
          message: `collection "${key}" enables inheritConfig but its source config could not be read: ${error instanceof Error ? error.message : String(error)}`,
          collection: key,
          owner: `collections.${key}.inheritConfig`,
          fix: "leadtype sync",
        });
      }
    }
    config = { ...loaded.config, collections: merged };
  }

  // Re-normalize so the resolved model reflects the inherited collections.
  //
  // Deprecations come from the *first* normalization, during load: aliases
  // were already folded onto canonical names there, so a second pass over the
  // canonical config correctly finds none — and reporting none would tell a
  // user with a legacy config that they have nothing to migrate.
  const renormalized = normalizeDocsConfig(config, {
    ...(loaded.path ? { configPath: loaded.path } : {}),
    configDir,
  });
  //
  // The acquisition graph comes from the first pass too. Inheritance only
  // merges content-owned fields — navigation, schema, flatteners, mounts —
  // and never touches `repository`/`ref`/`cacheDir`, so the first pass is
  // authoritative. It is also the only pass that saw `sources`, since
  // normalization expands those into `collections`; re-deriving would lose
  // every authored source name and report the graph as `repo#ref` instead.
  const sourceIdByCollection = new Map(
    loaded.resolved.collections.map((entry) => [entry.key, entry.sourceId])
  );
  const normalized = {
    config: renormalized.config,
    resolved: {
      ...renormalized.resolved,
      collections: renormalized.resolved.collections.map((entry) => ({
        ...entry,
        sourceId: sourceIdByCollection.get(entry.key) ?? entry.sourceId,
        provenance: stampInherited(
          entry.provenance,
          inheritedFields.get(entry.key),
          entry.key
        ),
      })),
      sources: loaded.resolved.sources,
      deprecations: loaded.resolved.deprecations,
    },
  };
  const fallbackContentDir = path.resolve(
    options.contentDir ??
      docsDirs[0] ??
      path.join(rootDir, DEFAULT_DOCS_DIRNAME)
  );

  let inference = emptyInferenceReport();
  const collections: ResolvedProjectCollection[] = [];

  for (const collection of normalized.resolved.collections) {
    const contentDir = await resolveContentDir(
      collection,
      normalized.config,
      configDir,
      fallbackContentDir,
      diagnostics
    );

    const merged = normalized.config.collections?.[collection.key];
    const navigation = merged?.navigation ?? collection.navigation;
    const groups = merged?.groups ?? collection.groups;

    let navigationOrigin: NavigationOrigin;
    let resolvedNavigation = navigation;
    if (navigation && navigation.length > 0) {
      navigationOrigin = inheritedNavigation.has(collection.key)
        ? "inherited"
        : "explicit";
    } else if (groups && groups.length > 0) {
      navigationOrigin = "groups";
    } else if (
      options.infer !== false &&
      contentDir &&
      // Not for localized projects — the same opt-out `generate` applies.
      // Derivation keys sections off the first path segment, which for
      // `docs/en/…` is the locale, so nav/doctor would report a locale-keyed
      // tree the real build never produces.
      normalized.config.i18n === undefined
    ) {
      // Derive over the same filtered file set the staging globs select:
      // `generate` stages a filtered mirror and derives from it, so deriving
      // over the raw tree here would report sections built from pages the
      // collection's include/exclude keeps out of every artifact.
      const derived = await inferNavigationFromContent(
        contentDir,
        await derivationPathFilter(collection, contentDir)
      );
      navigationOrigin = "inferred";
      resolvedNavigation = derived.navigation;
      inference = mergeInferenceReports(inference, derived.report);
    } else {
      navigationOrigin = "inferred";
    }

    collections.push({
      ...collection,
      ...(contentDir ? { contentDir } : {}),
      ...(resolvedNavigation ? { navigation: resolvedNavigation } : {}),
      ...(groups ? { groups } : {}),
      navigationOrigin,
    });
  }

  let sources = normalized.resolved.sources;

  // `--docs-dir` is repeatable, and `generate`'s legacy multi-dir path honors
  // every value: the first directory mounts at the docs root, each further
  // one under its folder name (`/docs/<basename>`) unless the value's
  // `=<url-prefix>` names a mount explicitly. A single-source project
  // resolves the same way here, so a report covers everything the build
  // stages instead of silently reading only the first directory.
  if (normalized.resolved.mode === "single-source" && !options.contentDir) {
    // `generate` applies an explicit prefix on the *first* value too
    // (`--docs-dir docs=/manual` serves the primary source at `/manual`), so
    // the primary collection follows it — leaving it at the normalized
    // default `/docs` reported URLs the build never renders.
    const primaryPrefix = docsDirInputs[0]?.urlPrefix;
    const primary = collections[0];
    if (primaryPrefix && primary) {
      collections[0] = {
        ...primary,
        routePrefix: primaryPrefix,
        provenance: {
          ...primary.provenance,
          routePrefix: { origin: "explicit" },
        },
      };
    }
    if (docsDirs.length > 1) {
      const extras = await synthesizeExtraDirCollections({
        rootDir,
        docsDirInputs,
        docsDirs,
        usedKeys: new Set(collections.map((entry) => entry.key)),
        sourceId: collections[0]?.sourceId ?? DEFAULT_SOURCE_ID,
        infer: options.infer !== false,
        diagnostics,
      });
      collections.push(...extras.collections);
      inference = mergeInferenceReports(inference, extras.inference);
      sources = sources.map((source) =>
        source.kind === "local"
          ? {
              ...source,
              collectionKeys: [...source.collectionKeys, ...extras.keys],
            }
          : source
      );
    }
  }

  return {
    rootDir,
    configDir,
    ...(loaded.path ? { configPath: loaded.path } : {}),
    configOrigin,
    config: normalized.config,
    resolved: normalized.resolved,
    collections,
    sources,
    inference,
    diagnostics,
  };
}
