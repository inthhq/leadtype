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

import path from "node:path";
import type { PluggableList } from "unified";
import { resolveProject } from "../config/project";
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
  /**
   * The project's docs config. Omit it to discover `leadtype.config.*` or
   * `docs.config.*` from `cwd` — an app that already has a config file has no
   * reason to import it just to hand it straight back.
   */
  config?: DocsConfig;
  /** Where to discover the config from, when `config` is omitted. Defaults to cwd. */
  cwd?: string;
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
 * Resolve a collection-local slug, which framework adapters produce when a
 * route is mounted per collection. Ambiguous across collections by nature, so
 * an ambiguous match is an error rather than a silent first-wins pick.
 */
function findByLocalSlug<TFrontmatter extends DocsFrontmatter>(
  pages: DocsProjectPageMeta<TFrontmatter>[],
  wanted: string
): DocsProjectPageMeta<TFrontmatter> | undefined {
  const matches = pages.filter((page) => page.slug.join("/") === wanted);
  if (matches.length > 1) {
    throw new Error(
      `createDocsProject: slug "${wanted}" is ambiguous — collections ${matches
        .map((page) => `"${page.collection}"`)
        .join(" and ")} both contain it. Load it by route path (${matches
        .map((page) => page.urlPath)
        .join(
          " or "
        )}), or mount a route per collection and use that collection's source.`
    );
  }
  return matches[0];
}

export async function createDocsProject<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  // Every field is optional: with no arguments at all, the project discovers
  // its config from the current directory and derives the rest.
  input: CreateDocsProjectConfig<TFrontmatter> = {}
): Promise<DocsProject<TFrontmatter>> {
  // One shared pipeline: discovery, source-owned inheritance, normalization,
  // inference, and per-collection content resolution. `generate`, `doctor`,
  // and `nav` read the same result, which is what keeps the rendered site and
  // the generated artifacts describing one project.
  const project = await resolveProject({
    // `configPath` names the file, so its directory is the project root only
    // for a root-level `leadtype.config.*`; for a `docs.config.*` the root is
    // one level up. `resolveProject` applies that rule from the basename, so
    // pass the path through rather than pre-collapsing it to a directory.
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.configDir ? { cwd: input.configDir } : {}),
    ...(input.contentDir ? { contentDir: input.contentDir } : {}),
    ...(input.config ? { config: input.config } : {}),
    ...(input.configPath ? { configPath: input.configPath } : {}),
  });

  // A resolution failure is fatal here: unlike doctor, there is nothing useful
  // to hand back to a renderer that asked for a working source.
  const blocking = project.diagnostics.find((entry) => entry.level === "error");
  if (blocking) {
    // The runtime adds context the shared diagnostic can't: a request handler
    // reaching an unsynced source must never resolve it by cloning.
    const runtimeNote = blocking.id.startsWith("source.")
      ? " The runtime reads the sync cache and never clones."
      : "";
    throw new Error(
      `createDocsProject: ${blocking.message}.${blocking.fix ? ` Run \`${blocking.fix}\`.` : ""}${runtimeNote}`
    );
  }
  const config = project.config;
  const resolved = project.resolved;
  if (!(config && resolved)) {
    throw new Error(
      `createDocsProject: no docs config found from "${project.rootDir}". Pass \`config\`, or add a leadtype.config.* / docs.config.* file.`
    );
  }

  // `openapi` is a top-level field with its own URL prefix, independent of any
  // collection, so there is no collection to attach the generated pages to in
  // multi-source mode. Generation emits them regardless — which would leave
  // the site serving fewer routes than its own sitemap and llms.txt advertise,
  // the precise failure this primitive exists to prevent. Fail loudly instead.
  if (config.openapi && resolved.mode === "multi-source") {
    throw new Error(
      "createDocsProject: `openapi` is not yet supported alongside `collections` — generation would emit API reference pages this project cannot route. Build that collection with `createDocsSource({ openapi })` directly, or move the spec into a collection's own docs config."
    );
  }

  // Resolved from the config when the caller doesn't override it — the same
  // fallback `typeTableStrict` already had, and the documented place to set it.
  const typeTableBasePath =
    input.typeTableBasePath ??
    (config.typeTableBasePath
      ? path.resolve(project.configDir, config.typeTableBasePath)
      : undefined);

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
  for (const collection of project.collections) {
    const contentDir = collection.contentDir as string;
    sourcesByCollection.set(
      collection.key,
      await createDocsSource<TFrontmatter>({
        contentDir,
        ...shared,
        ...(collection.navigation ? { nav: collection.navigation } : {}),
        ...(collection.groups ? { groups: collection.groups } : {}),
        // A page-existence filter, so it has to hold at runtime too — an
        // author excluding `drafts/**` must not have them served.
        ...(collection.include ? { include: collection.include } : {}),
        ...(collection.exclude ? { exclude: collection.exclude } : {}),
        ...(collection.frontmatterSchema
          ? {
              frontmatterSchema:
                collection.frontmatterSchema as CreateDocsSourceConfig<TFrontmatter>["frontmatterSchema"],
            }
          : {}),
        // A single-source project mounts at its route prefix like any other;
        // a multi-collection project gets one mount set per collection, which
        // is what makes each collection's URLs correct on its own.
        // Site-wide `mounts` apply to every collection; the collection's own
        // come first, matching the order generation composes them in.
        mounts: collectionMounts(collection.routePrefix, [
          ...(collection.mounts ?? []),
          ...(config.mounts ?? []),
        ]),
        ...(typeTableBasePath ? { typeTableBasePath } : {}),
        ...(config.openapi && resolved.mode === "single-source"
          ? { openapi: config.openapi, openapiCwd: project.configDir }
          : {}),
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
    // Route path first. A collection-local slug is ambiguous across
    // collections — two collections each holding `overview.mdx` both produce
    // `["overview"]`, and `index.mdx` produces `[]` in every one of them — so
    // matching it first would resolve to whichever collection was declared
    // earliest, silently and deterministically. The route path is unique by
    // construction, because distinct route prefixes are enforced at load.
    const target =
      pages.find(
        (page) => page.urlPath.replace(LEADING_SLASH, "") === wanted
      ) ?? findByLocalSlug(pages, wanted);
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

  const primary = getSource(project.collections[0]?.key ?? "");

  return {
    contentDir: primary.contentDir,
    collections: project.collections,
    sources: project.sources,
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
