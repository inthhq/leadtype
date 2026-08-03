/**
 * `createDocsProject()` — the resolved project as a runtime source.
 *
 * `createDocsSource()` describes one content directory. That is the right
 * primitive for a custom integration, but it means an app repeats what its
 * config already says — the content root, the navigation, the base URL — and a
 * multi-collection app repeats it per collection, plus mounts, prefixes, and
 * source-owned inheritance. Two descriptions of one project drift, and when
 * they do the rendered site and the generated agent artifacts disagree.
 *
 * A project reads the same resolved config the artifact pipeline reads, and
 * exposes it through the `DocsSource` contract so existing framework adapters
 * accept it unchanged:
 *
 * ```ts
 * const project = await createDocsProject({ config: docsConfig });
 *
 * createGenerateStaticParams({ source: project });  // adapters, as-is
 * project.collections;                              // plus the resolved graph
 * project.getSource("changelog");                   // and per-collection access
 * ```
 *
 * Remote collections are **cache-only** here. A request handler must never
 * clone a repository, so a missing or stale cache is a diagnostic naming
 * `leadtype sync`, not an implicit network call.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import type { PluggableList } from "unified";
import { inheritCollectionSourceConfigs } from "../config/inherit";
import { normalizeDocsConfig } from "../config/normalize";
import type { ResolvedDocsCollection, ResolvedSource } from "../config/types";
import type { DocsI18nConfig, LocaleCode } from "../i18n";
import {
  type DocsPathMount,
  normalizeBaseUrl,
  normalizeDocsPath,
  toAbsoluteUrl,
} from "../internal/docs-url";
import type { DocsConfig } from "../llm";
import type { DocsNavigation } from "../llm/readability";
import {
  type CreateDocsSearchIndexOptions,
  createDocsSearchIndex,
  type DocsSearchBundle,
  type DocsSearchDocument,
} from "../search/search";
import {
  type CreateDocsSourceConfig,
  createDocsSource,
  type DocsPage,
  type DocsPageMeta,
  type DocsSource,
} from "../source";
import { readSyncManifest, resolveCollection } from "../sync/sync";
import type { DocsFrontmatter, DocsTransformerOptions } from "../transformers";

/** A page, plus which collection it came from. */
export type DocsProjectPageMeta<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = DocsPageMeta<TFrontmatter> & {
  /** Collection id this page belongs to. */
  collection: string;
};

export type DocsProjectPage<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = DocsPage<TFrontmatter> & { collection: string };

/**
 * A `DocsSource` over the whole project. Structurally a superset, so anything
 * that accepts a source accepts a project.
 */
export type DocsProject<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = Omit<DocsSource<TFrontmatter>, "listPages" | "loadPage"> & {
  /** The resolved collections, in config order. */
  collections: ResolvedDocsCollection[];
  /** The resolved acquisition graph. */
  sources: ResolvedSource[];
  listPages(): Promise<DocsProjectPageMeta<TFrontmatter>[]>;
  loadPage(
    slug: string | string[]
  ): Promise<DocsProjectPage<TFrontmatter> | null>;
  /** The underlying source for one collection. Throws on an unknown id. */
  getSource(collectionKey: string): DocsSource<TFrontmatter>;
};

export type CreateDocsProjectConfig<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = {
  /** The project's docs config, as authored. */
  config: DocsConfig;
  /**
   * Path to the config file this came from. Preferred over `configDir`: it
   * fixes both where relative paths resolve *and* where the content root is,
   * using the same rules the CLI uses — a `docs.config.*` sits inside the docs
   * directory, a `leadtype.config.*` sits at the project root above it.
   */
  configPath?: string;
  /**
   * Directory relative paths resolve against. Defaults to the directory of
   * `configPath`, else `process.cwd()`.
   */
  configDir?: string;
  /**
   * Content root for a single-source project, where the config declares no
   * collections. Defaults to the directory holding a `docs.config.*`, or
   * `<configDir>/docs` otherwise.
   */
  contentDir?: string;
  baseUrl?: string;
  locale?: LocaleCode;
  i18n?: DocsI18nConfig;
  remarkPlugins?: PluggableList;
  typeTableBasePath?: string;
  typeTableStrict?: boolean;
  toc?: CreateDocsSourceConfig<TFrontmatter>["toc"];
  searchIndex?: CreateDocsSearchIndexOptions;
  transformers?: DocsTransformerOptions<TFrontmatter>["transformers"];
};

const DEFAULT_CONTENT_DIRNAME = "docs";
const LEADING_SLASH = /^\//;

function collectionMounts(
  routePrefix: string,
  extra: DocsPathMount[] | undefined
): DocsPathMount[] {
  // Every page in a collection hangs off its route prefix, so the collection's
  // own root is the base mount. Collection-declared mounts stay relative to it.
  return [
    { pathPrefix: "", urlPrefix: routePrefix },
    ...(extra ?? []).map((mount) => ({
      pathPrefix: normalizeDocsPath(mount.pathPrefix),
      urlPrefix: mount.urlPrefix,
    })),
  ];
}

/**
 * Resolve a collection's content directory without touching the network.
 *
 * For a remote collection that means reading the sync cache and checking the
 * manifest still matches the configured repository and ref — a cache left over
 * from a different ref would otherwise render stale content that looks fine.
 */
async function resolveCollectionDir(
  collection: ResolvedDocsCollection,
  config: DocsConfig,
  configDir: string,
  fallbackContentDir: string
): Promise<string> {
  const authored = config.collections?.[collection.key];
  if (!authored) {
    return fallbackContentDir;
  }
  const resolved = resolveCollection(collection.key, authored, configDir);
  if (!resolved.remote) {
    if (!existsSync(resolved.absoluteDir)) {
      throw new Error(
        `createDocsProject: collection "${collection.key}" points at "${resolved.absoluteDir}", which does not exist. Check its \`dir\` in your docs config.`
      );
    }
    return resolved.absoluteDir;
  }

  const { repository, ref, cacheDir } = resolved.remote;
  if (!existsSync(path.join(cacheDir, ".git"))) {
    throw new Error(
      `createDocsProject: collection "${collection.key}" reads ${repository}@${ref}, which has not been synced (no checkout at "${cacheDir}"). Run \`leadtype sync\` first — the runtime never clones.`
    );
  }
  const manifest = await readSyncManifest(cacheDir);
  if (!manifest) {
    throw new Error(
      `createDocsProject: the cache for collection "${collection.key}" at "${cacheDir}" has no sync manifest, so its revision can't be verified. Run \`leadtype sync --refresh\`.`
    );
  }
  if (manifest.repository !== repository || manifest.ref !== ref) {
    throw new Error(
      `createDocsProject: the cache for collection "${collection.key}" holds ${manifest.repository}@${manifest.ref}, but the config asks for ${repository}@${ref}. Run \`leadtype sync --refresh\`.`
    );
  }
  if (!existsSync(resolved.absoluteDir)) {
    throw new Error(
      `createDocsProject: collection "${collection.key}" expects "${authored.dir}" inside ${repository}@${ref}, but "${resolved.absoluteDir}" does not exist. Check the collection's \`dir\`.`
    );
  }
  return resolved.absoluteDir;
}

export async function createDocsProject<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  input: CreateDocsProjectConfig<TFrontmatter>
): Promise<DocsProject<TFrontmatter>> {
  const configDir = path.resolve(
    input.configDir ??
      (input.configPath ? path.dirname(input.configPath) : process.cwd())
  );

  // Source-owned inheritance runs before normalization, exactly as generation
  // does it — same function, so the rendered site and the generated artifacts
  // cannot end up with different navigation for the same collection.
  const withInheritance: DocsConfig = input.config.collections
    ? {
        ...input.config,
        collections: await inheritCollectionSourceConfigs(
          input.config.collections,
          configDir
        ),
      }
    : input.config;

  const { config, resolved } = normalizeDocsConfig(withInheritance, {
    configDir,
  });

  // A `docs.config.*` lives *inside* the docs directory; a `leadtype.config.*`
  // lives at the project root above it. Same rule the CLI's config lookup
  // uses, so a project and a `generate` run agree on the content root.
  const configIsSourceOwned = input.configPath
    ? path.basename(input.configPath).startsWith("docs.config.")
    : false;
  const fallbackContentDir = path.resolve(
    input.contentDir ??
      (configIsSourceOwned
        ? configDir
        : path.join(configDir, DEFAULT_CONTENT_DIRNAME))
  );

  const shared = {
    baseUrl: input.baseUrl,
    locale: input.locale,
    i18n: input.i18n ?? config.i18n,
    remarkPlugins: input.remarkPlugins,
    typeTableStrict: input.typeTableStrict ?? config.typeTableStrict,
    toc: input.toc,
    searchIndex: input.searchIndex,
    // A config's `transformers` are declared against its own frontmatter type,
    // which the caller re-states as `TFrontmatter`. The two agree by
    // construction, but the config type has already erased its parameter.
    transformers: (input.transformers ??
      config.transformers) as DocsTransformerOptions<TFrontmatter>["transformers"],
  } satisfies Partial<CreateDocsSourceConfig<TFrontmatter>>;

  const sourcesByCollection = new Map<string, DocsSource<TFrontmatter>>();
  for (const collection of resolved.collections) {
    const contentDir = await resolveCollectionDir(
      collection,
      config,
      configDir,
      fallbackContentDir
    );
    const authored = config.collections?.[collection.key];
    sourcesByCollection.set(
      collection.key,
      await createDocsSource<TFrontmatter>({
        contentDir,
        ...shared,
        ...(collection.navigation ? { nav: collection.navigation } : {}),
        ...(collection.groups ? { groups: collection.groups } : {}),
        ...(collection.frontmatterSchema
          ? {
              frontmatterSchema:
                collection.frontmatterSchema as CreateDocsSourceConfig<TFrontmatter>["frontmatterSchema"],
            }
          : {}),
        // A single-source project mounts at its route prefix like any other;
        // a multi-collection project gets one mount set per collection, which
        // is what makes each collection's URLs correct on its own.
        mounts: collectionMounts(collection.routePrefix, collection.mounts),
        ...(input.typeTableBasePath
          ? { typeTableBasePath: input.typeTableBasePath }
          : {}),
        ...(config.openapi && resolved.mode === "single-source"
          ? { openapi: config.openapi, openapiCwd: configDir }
          : {}),
        ...(authored?.flatteners ? {} : {}),
      })
    );
  }

  function getSource(collectionKey: string): DocsSource<TFrontmatter> {
    const source = sourcesByCollection.get(collectionKey);
    if (!source) {
      throw new Error(
        `createDocsProject: unknown collection "${collectionKey}". Declared collections: ${[...sourcesByCollection.keys()].join(", ") || "(none)"}.`
      );
    }
    return source;
  }

  let cachedPages: DocsProjectPageMeta<TFrontmatter>[] | null = null;

  async function listPages(): Promise<DocsProjectPageMeta<TFrontmatter>[]> {
    if (cachedPages) {
      return cachedPages;
    }
    const pages: DocsProjectPageMeta<TFrontmatter>[] = [];
    const byUrlPath = new Map<string, string>();
    for (const [collection, source] of sourcesByCollection) {
      for (const page of await source.listPages()) {
        const owner = byUrlPath.get(page.urlPath);
        if (owner) {
          throw new Error(
            `createDocsProject: collections "${owner}" and "${collection}" both resolve "${page.urlPath}". Give them distinct route prefixes.`
          );
        }
        byUrlPath.set(page.urlPath, collection);
        pages.push({ ...page, collection });
      }
    }
    cachedPages = pages;
    return pages;
  }

  /**
   * Resolve a slug against the merged route space.
   *
   * Two slug shapes reach here and both must work. A route mounted per
   * collection hands over a collection-local slug (`1-0`), which is what
   * `createDocsSource` produces and what existing adapters pass. A route
   * mounted across collections hands over the full route (`changelog/1-0`).
   * Matching the local slug first keeps single-source behaviour identical to
   * `createDocsSource`; falling back to the route path is what lets a
   * multi-collection app serve everything from one handler.
   */
  async function loadPage(
    slugInput: string | string[]
  ): Promise<DocsProjectPage<TFrontmatter> | null> {
    const segments = (
      Array.isArray(slugInput) ? slugInput : slugInput.split("/")
    ).filter(Boolean);
    const wanted = segments.join("/");
    const pages = await listPages();
    const target =
      pages.find((page) => page.slug.join("/") === wanted) ??
      pages.find((page) => page.urlPath.replace(LEADING_SLASH, "") === wanted);
    if (!target) {
      return null;
    }
    const page = await getSource(target.collection).loadPage(target.slug);
    return page ? { ...page, collection: target.collection } : null;
  }

  async function getNavigation(): Promise<DocsNavigation> {
    // Each collection resolves its own navigation with its own mounts, so the
    // merge is a concatenation in config order rather than a re-derivation.
    const manifests = await Promise.all(
      [...sourcesByCollection.values()].map((source) => source.getNavigation())
    );
    const first = manifests[0];
    return {
      groups: manifests.flatMap((manifest) => manifest.groups),
      ungrouped: manifests.flatMap((manifest) => manifest.ungrouped),
      unknown: manifests.flatMap((manifest) => manifest.unknown),
      ...(first?.locale ? { locale: first.locale } : {}),
    };
  }

  async function buildSearchIndex(): Promise<DocsSearchBundle> {
    const sources = [...sourcesByCollection.values()];
    const single = sources[0];
    if (!single) {
      throw new Error("createDocsProject: no collections to index.");
    }
    if (sources.length === 1) {
      return await single.buildSearchIndex();
    }

    // A search index is inverted: its term postings point at document and
    // chunk positions. Concatenating two finished indexes would leave every
    // posting in the second one pointing at the wrong document, so the merged
    // index is built once over every collection's documents.
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const metas = await listPages();
    const documents: DocsSearchDocument[] = [];
    for (const meta of metas) {
      if (meta.isFallback) {
        continue;
      }
      const loaded = await getSource(meta.collection).loadPage(meta.slug);
      if (!loaded) {
        continue;
      }
      documents.push({
        id: meta.urlPath,
        title: meta.title,
        description: meta.description,
        urlPath: meta.urlPath,
        absoluteUrl: toAbsoluteUrl(meta.urlPath, baseUrl),
        relativePath: meta.relativePath,
        ...(meta.locale ? { locale: meta.locale } : {}),
        ...(meta.sourceLocale ? { sourceLocale: meta.sourceLocale } : {}),
        ...(meta.logicalPath ? { logicalPath: meta.logicalPath } : {}),
        frontmatter: loaded.frontmatter,
        content: loaded.markdown,
      });
    }

    const index = createDocsSearchIndex(documents, {
      ...input.searchIndex,
      transformers:
        shared.transformers as DocsTransformerOptions["transformers"],
    });
    return {
      index,
      content: index.content ?? {
        version: index.version,
        generatedAt: index.generatedAt,
        chunks: [],
      },
    };
  }

  const primary = getSource(resolved.collections[0]?.key ?? "");

  return {
    contentDir: primary.contentDir,
    collections: resolved.collections,
    sources: resolved.sources,
    getSource,
    getNavigation,
    listPages,
    loadPage,
    buildSearchIndex,
    resolveInclude: primary.resolveInclude,
    async cleanup(): Promise<void> {
      await Promise.all(
        [...sourcesByCollection.values()].map((source) => source.cleanup())
      );
    },
  };
}
