/**
 * The resolved project model.
 *
 * `DocsConfig` is the *authoring* shape: several fields have historical names,
 * some concepts can be expressed two ways, and remote acquisition is declared
 * per collection even when collections share a repository. `ResolvedDocsConfig`
 * is the single *internal* shape every subsystem reads — generate, sync, lint,
 * score, the runtime source, and diagnostics — so none of them re-derive the
 * project from raw config, and none of them disagree about it.
 *
 * Two things the resolved shape adds beyond canonical names:
 *
 *   - **A source graph.** Collections point at a source; sources own
 *     acquisition. Collections sharing `(repository, ref)` resolve to one
 *     source with both keys listed, which is what sync already does internally.
 *   - **Provenance.** Every resolved value records where it came from —
 *     authored here, inherited from a source repo, inferred, or a documented
 *     default — so a person or an agent can ask "why is this value what it is?"
 *     without reading the normalizer.
 */

import type { DocsPathMount } from "../internal/docs-url";
import type {
  DocsGroup,
  DocsNavEntry,
  ProductInfo,
  SourceConfigInheritance,
} from "../llm/llm";
import type { DocsFrontmatterSchema } from "../transformers";

/** Where a resolved value came from. */
export type ConfigValueOrigin =
  /** Authored in the project's own config file. */
  | "explicit"
  /** Inherited from a source repository's own `docs.config.*`. */
  | "inherited"
  /** Derived by leadtype from content, `package.json`, or another config value. */
  | "inferred"
  /** A documented static default; nothing was authored. */
  | "default";

export type FieldProvenance = {
  origin: ConfigValueOrigin;
  /** Absolute path of the config file the value was authored in. */
  configPath?: string;
  /**
   * The field name as authored, when it differs from the canonical name —
   * e.g. `prefix` for a resolved `routePrefix`. Present only for deprecated
   * aliases, so diagnostics can point at the exact line a user wrote.
   */
  authoredAs?: string;
  /** For `inherited` values, the collection key whose source supplied it. */
  inheritedFrom?: string;
  /** For `inferred` values, a one-line explanation of the derivation. */
  inferredFrom?: string;
};

/**
 * A deprecated field that was normalized. Ids are stable so JSON consumers can
 * key on them; the message is what a human sees.
 */
export type ConfigDeprecation = {
  /** Stable id, e.g. `collection.prefix`. */
  id: string;
  /** Field path as authored, e.g. `collections.docs.prefix`. */
  field: string;
  /** Canonical field path to move to, e.g. `collections.docs.routePrefix`. */
  replacement: string;
  message: string;
};

/** A local content directory. Nothing to acquire. */
export type ResolvedLocalSource = {
  id: string;
  kind: "local";
  /** Collection keys reading from this source. */
  collectionKeys: string[];
};

/**
 * One git acquisition. Collections sharing `(repository, ref)` share this
 * entry — the clone happens once, and a failure names every dependent
 * collection.
 */
export type ResolvedGitSource = {
  id: string;
  kind: "git";
  repository: string;
  ref: string;
  /**
   * Whether `ref` pins a specific commit. A branch or a moving tag resolves
   * differently on different machines and at different times, which is worth
   * surfacing for a production docs build.
   */
  refKind: "commit" | "mutable";
  /** Authored `cacheDir` override, relative to the config directory. */
  cacheDir?: string;
  collectionKeys: string[];
};

export type ResolvedSource = ResolvedLocalSource | ResolvedGitSource;

export type ResolvedDocsCollection = {
  key: string;
  /**
   * Directory containing the MDX, as authored, relative to the source root.
   *
   * Always set in multi-source mode. Absent in single-source mode, where the
   * content root is supplied by the host instead — `--docs-dir` for the CLI, or
   * `contentDir` for the runtime source — and the config genuinely does not
   * know it. Provenance records that.
   */
  dir?: string;
  /** Public URL prefix, normalized. */
  routePrefix: string;
  include?: string[];
  exclude?: string[];
  frontmatterSchema?: DocsFrontmatterSchema;
  navigation?: DocsNavEntry[];
  groups?: DocsGroup[];
  mounts?: DocsPathMount[];
  inheritConfig?: SourceConfigInheritance;
  /** Id of the entry in {@link ResolvedDocsConfig.sources} this reads from. */
  sourceId: string;
  /** Per-field origin, keyed by canonical field name. */
  provenance: Record<string, FieldProvenance>;
};

/**
 * Single-source projects declare content at the top level; multi-source
 * projects declare a `collections` map. The two are mutually exclusive and
 * validated centrally rather than per subsystem.
 */
export type ResolvedProjectMode = "single-source" | "multi-source";

export type ResolvedDocsConfig = {
  mode: ResolvedProjectMode;
  /** Absolute path of the config file this was resolved from. */
  configPath?: string;
  /** Directory the config was loaded from; relative paths resolve against it. */
  configDir?: string;
  product: ProductInfo;
  /**
   * Every collection, in declaration order. A single-source project resolves
   * to exactly one collection so downstream code has one shape to handle.
   */
  collections: ResolvedDocsCollection[];
  /** Deduped acquisition graph. */
  sources: ResolvedSource[];
  /** Deprecated fields that were normalized, in authoring order. */
  deprecations: ConfigDeprecation[];
  /** Provenance for top-level fields, keyed by canonical field name. */
  provenance: Record<string, FieldProvenance>;
};

/** The default collection key a single-source project resolves to. */
export const DEFAULT_COLLECTION_KEY = "docs";

/** The id of the implicit local source a single-source project resolves to. */
export const DEFAULT_SOURCE_ID = "local";

/**
 * A JSON-safe view of the resolved config, for `--json` output and snapshots.
 * Function-valued fields (frontmatter schemas, flatteners, transformers) can't
 * cross a JSON boundary, so they are reported as presence flags rather than
 * silently dropped — a reader needs to know a schema is in play even when it
 * can't be serialized.
 */
export type SerializableResolvedConfig = {
  mode: ResolvedProjectMode;
  configPath?: string;
  product: ProductInfo;
  collections: {
    key: string;
    dir?: string;
    routePrefix: string;
    sourceId: string;
    include?: string[];
    exclude?: string[];
    hasFrontmatterSchema: boolean;
    hasNavigation: boolean;
    hasGroups: boolean;
    mounts?: DocsPathMount[];
    inheritConfig?: SourceConfigInheritance;
    provenance: Record<string, FieldProvenance>;
  }[];
  sources: ResolvedSource[];
  deprecations: ConfigDeprecation[];
  provenance: Record<string, FieldProvenance>;
};

export function serializeResolvedConfig(
  resolved: ResolvedDocsConfig
): SerializableResolvedConfig {
  return {
    mode: resolved.mode,
    ...(resolved.configPath ? { configPath: resolved.configPath } : {}),
    product: resolved.product,
    collections: resolved.collections.map((collection) => ({
      key: collection.key,
      ...(collection.dir === undefined ? {} : { dir: collection.dir }),
      routePrefix: collection.routePrefix,
      sourceId: collection.sourceId,
      ...(collection.include ? { include: collection.include } : {}),
      ...(collection.exclude ? { exclude: collection.exclude } : {}),
      hasFrontmatterSchema: collection.frontmatterSchema !== undefined,
      hasNavigation: collection.navigation !== undefined,
      hasGroups: collection.groups !== undefined,
      ...(collection.mounts ? { mounts: collection.mounts } : {}),
      ...(collection.inheritConfig === undefined
        ? {}
        : { inheritConfig: collection.inheritConfig }),
      provenance: collection.provenance,
    })),
    sources: resolved.sources,
    deprecations: resolved.deprecations,
    provenance: resolved.provenance,
  };
}
