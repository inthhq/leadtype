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
import { type LoadedDocsConfig, loadDocsConfig } from "./load";
import { normalizeDocsConfig } from "./normalize";
import type {
  FieldProvenance,
  ResolvedDocsCollection,
  ResolvedDocsConfig,
  ResolvedSource,
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
  /** Absolute path of the discovered config, if there is one. */
  configPath?: string;
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
  loaded: LoadedDocsConfig,
  configDir: string,
  fallbackDir: string,
  diagnostics: ProjectDiagnostic[]
): Promise<string | undefined> {
  const authored = loaded.config.collections?.[collection.key];
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
    if (!sameSparse(manifest.sparse, resolvedCollection.remote.sparse)) {
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
  const docsDirs = docsDirNames.map((dir) => path.resolve(rootDir, dir));
  const diagnostics: ProjectDiagnostic[] = [];

  // A caller that already holds the config skips discovery; it still goes
  // through normalization so the resolved model is identical either way.
  const loaded: LoadedDocsConfig | null = options.config
    ? {
        ...normalizeDocsConfig(options.config, {
          ...(options.configPath ? { configPath: options.configPath } : {}),
          configDir: options.configPath
            ? path.dirname(options.configPath)
            : rootDir,
        }),
        path: options.configPath ?? path.join(rootDir, "leadtype.config.ts"),
      }
    : await loadDocsConfig({ cwd: rootDir, docsDirs });
  if (!loaded) {
    diagnostics.push({
      id: "config.missing",
      level: "warn",
      message: `no leadtype.config.* at "${rootDir}" and no docs.config.* in ${docsDirNames.join(", ")}`,
      fix: "leadtype init",
    });
    return emptyProject(rootDir, diagnostics);
  }

  const configDir = path.dirname(loaded.path);

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
    configPath: loaded.path,
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
  const withInheritance: LoadedDocsConfig = {
    config: normalized.config,
    path: loaded.path,
    resolved: normalized.resolved,
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
      withInheritance,
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
    } else if (options.infer !== false && contentDir) {
      const derived = await inferNavigationFromContent(contentDir);
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

  return {
    rootDir,
    configDir,
    configPath: loaded.path,
    config: normalized.config,
    resolved: normalized.resolved,
    collections,
    sources: normalized.resolved.sources,
    inference,
    diagnostics,
  };
}
