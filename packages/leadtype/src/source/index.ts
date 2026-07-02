/**
 * `createDocsSource()` — framework-neutral docs source primitive.
 *
 * Wraps the existing leadtype primitives (`resolveDocsNavigation`,
 * `createDocsSearchIndex`, `convertMdxFile`, `resolveInclude`, …) into a
 * single object consumers can wire into any renderer:
 *
 *   - fumadocs: see `leadtype/fumadocs`.
 *   - Next App Router: import the source object, call `loadPage(slug)` from a
 *     server component, render `result.ast` with `@mdx-js/mdx`.
 *   - Vite + @mdx-js/rollup: import source `.mdx` directly through the bundler
 *     with `createMdxSourcePlugins()`; this primitive provides nav + search.
 *
 * The primitive does **no I/O on construction** beyond a directory scan for
 * `listPages()`. Page bodies are loaded on demand.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import type { Root } from "mdast";
import { glob as fg } from "tinyglobby";
import type { PluggableList } from "unified";
import { convertMdxFile, resolveMdxFrontmatter } from "../convert/convert";
import {
  type DocsI18nConfig,
  type LocaleCode,
  logicalPathFromLocaleRelativePath,
  normalizeDocsI18nConfig,
  outputRelativePathForLocale,
  toLocalizedDocsUrlPath,
} from "../i18n";
import {
  type DocsPathMount,
  normalizeBaseUrl,
  normalizeDocsPath,
  stripDocsExtension,
  toAbsoluteUrl,
  toDocsUrlPath,
} from "../internal/docs-url";
import type {
  DocsGroup,
  DocsNavEntry,
  DocsTableOfContentsItem,
  DocsTableOfContentsOptions,
} from "../llm";
import { extractDocsTableOfContents, resolveDocsNavigation } from "../llm";
import type { DocsNavigation } from "../llm/readability";
import { createMdxSourcePlugins } from "../mdx/source-preset";
import { type DocsOpenApiConfig, stageOpenApiDocs } from "../openapi";
import {
  type IncludeResolution,
  type ResolveIncludeOptions,
  resolveInclude,
} from "../remark/plugins/include.remark";
import {
  type CreateDocsSearchIndexOptions,
  createDocsSearchIndex,
  type DocsSearchBundle,
  type DocsSearchDocument,
  type DocsSearchIndex,
} from "../search/search";
import type { DocsFrontmatter, DocsTransformerOptions } from "../transformers";

const DOC_EXTENSIONS = [".md", ".mdx"] as const;

export type DocsPageMeta<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = {
  /** Slug segments derived from the relative path (no extension, no `index`). */
  slug: string[];
  /** Canonical site URL path (e.g. `/docs/quickstart`). */
  urlPath: string;
  /** Source path relative to `contentDir`, **without** extension. */
  relativePath: string;
  /** Source file extension (".md" or ".mdx"). */
  extension: ".md" | ".mdx";
  /** Absolute path of the source file. Useful for deep framework adapters. */
  filePath: string;
  /** Resolved title (frontmatter `title:`, falling back to the filename). */
  title: string;
  /** Resolved description from frontmatter; may be empty. */
  description: string;
  /** Group slugs declared in frontmatter. */
  groups: string[];
  /** Parsed and transformed frontmatter for this page. */
  frontmatter: TFrontmatter;
  locale?: LocaleCode;
  sourceLocale?: LocaleCode;
  isFallback?: boolean;
  logicalPath?: string;
};

export type DocsPage<TFrontmatter extends DocsFrontmatter = DocsFrontmatter> =
  DocsPageMeta<TFrontmatter> & {
    /** Parsed frontmatter as a plain object. */
    frontmatter: TFrontmatter;
    /** Serialized markdown after the configured remark plugins ran. */
    markdown: string;
    /** mdast Root after the configured plugins ran — render this for live MDX. */
    ast: Root;
    /** Table of contents derived from the document's headings. */
    toc: DocsTableOfContentsItem[];
  };

export type CreateDocsSourceConfig<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = {
  /** Directory containing source `.md` / `.mdx` files (e.g. `"./content/docs"`). */
  contentDir: string;
  /**
   * Optional doc-groups for navigation. When omitted, navigation is still
   * computed but `groups` will be empty (all pages appear under `ungrouped`).
   */
  groups?: DocsGroup[];
  /** Curated navigation tree. Preferred over `groups`. */
  nav?: DocsNavEntry[];
  /** Base URL for absolute links (search index, TOC anchors). */
  baseUrl?: string;
  /** Multi-mount configuration; matches `resolveDocsNavigation`. */
  mounts?: DocsPathMount[];
  /**
   * Remark plugins to apply when loading pages. Defaults to Leadtype's source
   * preset (expand includes, resolve `<ExtractedTypeTable>`, strip authoring `import`s).
   * Pass `[]` to skip transforms.
   */
  remarkPlugins?: PluggableList;
  /**
   * Base directory for `<ExtractedTypeTable>` / `<AutoTypeTable path="…">`
   * resolution. Defaults to the parent of `contentDir`, matching a source
   * root such as `.c15t` for `.c15t/docs`.
   */
  typeTableBasePath?: string;
  /** Throw when a referenced type cannot be extracted. */
  typeTableStrict?: boolean;
  /** TOC extraction options. Pass `false` to skip TOC computation entirely. */
  toc?: DocsTableOfContentsOptions | false;
  /** Search-index tuning. */
  searchIndex?: CreateDocsSearchIndexOptions;
  /** Optional custom frontmatter schema for page metadata and loaded pages. */
  frontmatterSchema?: DocsTransformerOptions<TFrontmatter>["frontmatterSchema"];
  /** Build-time lifecycle hooks for source, conversion, and search data. */
  transformers?: DocsTransformerOptions<TFrontmatter>["transformers"];
  /** Optional locale configuration. When present, `locale` selects the active docs language. */
  i18n?: DocsI18nConfig;
  locale?: LocaleCode;
  /**
   * OpenAPI specs to generate API reference pages from. Pages are staged into
   * a temp copy of `contentDir` (the source directory is never modified) and
   * their navigation nodes are appended to `nav`.
   */
  openapi?: DocsOpenApiConfig;
  /**
   * Base directory for relative `openapi` input paths — typically the
   * directory containing your docs config. Defaults to `contentDir`.
   */
  openapiCwd?: string;
};

export type DocsSource<TFrontmatter extends DocsFrontmatter = DocsFrontmatter> =
  {
    /** Absolute path to the resolved docs directory. */
    contentDir: string;
    /** Compute the docs navigation from configured groups + filesystem state. */
    getNavigation(): Promise<DocsNavigation>;
    /** Enumerate every doc page found under `contentDir`. */
    listPages(): Promise<DocsPageMeta<TFrontmatter>[]>;
    /**
     * Load a single page by slug. Accepts either an already-split slug array or
     * a slash-joined string. Returns `null` if no matching file exists.
     */
    loadPage(slug: string | string[]): Promise<DocsPage<TFrontmatter> | null>;
    /** Build a search index from every page's resolved markdown. */
    buildSearchIndex(): Promise<DocsSearchBundle>;
    /**
     * Resolve an `<include>` reference outside of a remark pass (e.g. when
     * loading a partial for direct rendering). `fromPath` defaults to
     * `contentDir`.
     */
    resolveInclude(
      specifier: string,
      options?: Partial<ResolveIncludeOptions>
    ): Promise<IncludeResolution>;
  };

function isDocFile(filePath: string): boolean {
  return DOC_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function deriveSlug(relativePath: string): string[] {
  const withoutExtension = stripDocsExtension(relativePath);
  return withoutExtension
    .split("/")
    .filter((segment) => segment.length > 0)
    .reduce<string[]>((acc, segment, index, array) => {
      if (segment === "index" && index === array.length - 1) {
        return acc;
      }
      acc.push(segment);
      return acc;
    }, []);
}

function titleFromRelativePath(relativePath: string): string {
  const stripped = stripDocsExtension(relativePath);
  const last = stripped.split("/").filter(Boolean).pop() ?? "Untitled";
  const segment = last === "index" ? "Index" : last;
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeGroupValue(value: unknown): string[] {
  if (typeof value === "string") {
    return [value.trim()].filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

async function readPageMeta<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  selected: SelectedSourceFile,
  mounts?: DocsPathMount[],
  i18n?: DocsI18nConfig,
  transformOptions: DocsTransformerOptions<TFrontmatter> = {}
): Promise<DocsPageMeta<TFrontmatter>> {
  const { contentDir, filePath } = selected;
  const relativePath = normalizeDocsPath(path.relative(contentDir, filePath));
  const resolved = await resolveMdxFrontmatter(filePath, [], false, {
    frontmatterSchema: transformOptions.frontmatterSchema,
    transformers: transformOptions.transformers,
    transformContext: {
      stage: "source",
      filePath,
      relativePath: selected.outputRelativePath,
      locale: selected.locale,
      ...transformOptions.transformContext,
    },
  });
  const frontmatter = resolved.data;
  const title =
    String(frontmatter.title ?? "").trim() ||
    titleFromRelativePath(
      `${selected.logicalPath}${path.extname(relativePath)}`
    );
  const description = String(frontmatter.description ?? "").trim();
  const groups = normalizeGroupValue(frontmatter.group);
  const extension = filePath.endsWith(".mdx") ? ".mdx" : ".md";
  const slug = deriveSlug(`${selected.outputRelativePath}${extension}`);
  const urlPath =
    i18n && selected.locale
      ? toLocalizedDocsUrlPath(
          `${selected.logicalPath}${extension}`,
          selected.locale,
          i18n,
          mounts
        )
      : toDocsUrlPath(relativePath, mounts);
  return {
    slug,
    urlPath,
    relativePath: selected.outputRelativePath,
    extension,
    filePath,
    title,
    description,
    groups,
    frontmatter,
    ...(selected.locale ? { locale: selected.locale } : {}),
    ...(selected.sourceLocale ? { sourceLocale: selected.sourceLocale } : {}),
    ...(selected.isFallback === undefined
      ? {}
      : { isFallback: selected.isFallback }),
    ...(selected.logicalPath ? { logicalPath: selected.logicalPath } : {}),
  };
}

type SelectedSourceFile = {
  contentDir: string;
  filePath: string;
  logicalPath: string;
  outputRelativePath: string;
  locale?: LocaleCode;
  sourceLocale?: LocaleCode;
  isFallback?: boolean;
};

function selectSourceFiles(
  files: string[],
  contentDir: string,
  i18n?: DocsI18nConfig,
  locale?: LocaleCode
): SelectedSourceFile[] {
  const normalized = normalizeDocsI18nConfig(i18n);
  if (!normalized) {
    return files.map((filePath) => {
      const relativePath = normalizeDocsPath(
        path.relative(contentDir, filePath)
      );
      return {
        contentDir,
        filePath,
        logicalPath: stripDocsExtension(relativePath),
        outputRelativePath: stripDocsExtension(relativePath),
      };
    });
  }

  const outputLocale = locale ?? normalized.defaultLocale;
  const knownLocale = normalized.locales.some(
    (entry) => entry.code === outputLocale
  );
  if (!knownLocale) {
    throw new Error(`Unknown locale "${outputLocale}" in i18n config.`);
  }

  const localeCodes = new Set(normalized.locales.map((entry) => entry.code));
  const relativePaths = files.map((filePath) =>
    normalizeDocsPath(path.relative(contentDir, filePath))
  );
  const hasRootDefault = relativePaths.some((relativePath) => {
    const first = relativePath.split("/")[0] ?? "";
    return !localeCodes.has(first);
  });
  const hasDefaultFolder = relativePaths.some((relativePath) =>
    relativePath.startsWith(`${normalized.defaultLocale}/`)
  );
  if (hasRootDefault && hasDefaultFolder) {
    throw new Error(
      `Ambiguous i18n default-locale layout. Use either root docs files or docs/${normalized.defaultLocale}/ files for the default locale, not both.`
    );
  }

  const byLogicalPath = new Map<string, Map<LocaleCode, SelectedSourceFile>>();
  for (const filePath of files) {
    const relativePath = normalizeDocsPath(path.relative(contentDir, filePath));
    const { logicalPath, sourceLocale } = logicalPathFromLocaleRelativePath(
      relativePath,
      localeCodes
    );
    const resolvedSourceLocale = sourceLocale ?? normalized.defaultLocale;
    const localeFiles = byLogicalPath.get(logicalPath) ?? new Map();
    const outputRelativePath = outputRelativePathForLocale(
      logicalPath,
      outputLocale,
      i18n
    );
    const existing = localeFiles.get(resolvedSourceLocale);
    if (existing) {
      throw new Error(
        `Duplicate docs file for locale "${resolvedSourceLocale}" at "${outputRelativePath}": "${existing.filePath}" conflicts with "${filePath}". Rename one or remove it.`
      );
    }

    localeFiles.set(resolvedSourceLocale, {
      contentDir,
      filePath,
      logicalPath,
      outputRelativePath,
      locale: outputLocale,
      sourceLocale: resolvedSourceLocale,
      isFallback: resolvedSourceLocale !== outputLocale,
    });
    byLogicalPath.set(logicalPath, localeFiles);
  }

  const selected: SelectedSourceFile[] = [];
  for (const localeFiles of byLogicalPath.values()) {
    const direct = localeFiles.get(outputLocale);
    const fallback =
      outputLocale === normalized.defaultLocale
        ? undefined
        : localeFiles.get(normalized.defaultLocale);
    const match = direct ?? fallback;
    if (match) {
      selected.push(match);
    }
  }
  return selected.sort((left, right) =>
    left.outputRelativePath.localeCompare(right.outputRelativePath)
  );
}

export async function createDocsSource<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  config: CreateDocsSourceConfig<TFrontmatter>
): Promise<DocsSource<TFrontmatter>> {
  const sourceContentDir = path.resolve(config.contentDir);
  if (!existsSync(sourceContentDir)) {
    throw new Error(
      `createDocsSource: contentDir does not exist at "${sourceContentDir}"`
    );
  }

  // OpenAPI generation stages a temp copy of the source so generated pages
  // exist on disk without polluting the authored docs. Nav nodes for the
  // generated pages are appended to the curated nav.
  let contentDir = sourceContentDir;
  let nav = config.nav;
  if (config.openapi !== undefined) {
    const staged = await stageOpenApiDocs({
      contentDir: sourceContentDir,
      cwd: config.openapiCwd,
      openapi: config.openapi,
    });
    contentDir = staged.contentDir;
    nav = [...(config.nav ?? []), ...staged.nav];
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  // Type-table and include resolution stay anchored to the *original* source
  // tree so relative references outside the docs dir keep working when the
  // content is staged.
  const contentParentDir = path.dirname(sourceContentDir);
  const defaultTypeTableBasePath =
    contentParentDir === sourceContentDir ? sourceContentDir : contentParentDir;
  const typeTableBasePath = path.resolve(
    config.typeTableBasePath ?? defaultTypeTableBasePath
  );
  const remarkPlugins =
    config.remarkPlugins ??
    createMdxSourcePlugins({
      typeTableBasePath,
      typeTableStrict: config.typeTableStrict,
    });
  const tocOptions: DocsTableOfContentsOptions | false =
    config.toc === false ? false : (config.toc ?? {});

  let cachedFiles: string[] | null = null;
  let cachedMetas: DocsPageMeta<TFrontmatter>[] | null = null;
  // Slug → meta lookup populated alongside cachedMetas so loadPage runs in O(1).
  let cachedMetaBySlug: Map<string, DocsPageMeta<TFrontmatter>> | null = null;

  async function listFiles(): Promise<string[]> {
    if (cachedFiles) {
      return cachedFiles;
    }
    const matches = await fg("**/*.{md,mdx}", {
      absolute: true,
      cwd: contentDir,
      onlyFiles: true,
    });
    cachedFiles = matches
      .filter(isDocFile)
      .sort((left, right) => left.localeCompare(right));
    return cachedFiles;
  }

  async function listMetas(): Promise<DocsPageMeta<TFrontmatter>[]> {
    if (cachedMetas) {
      return cachedMetas;
    }
    const files = await listFiles();
    const selectedFiles = selectSourceFiles(
      files,
      contentDir,
      config.i18n,
      config.locale
    );
    const metas = await Promise.all(
      selectedFiles.map((file) =>
        readPageMeta(file, config.mounts, config.i18n, {
          frontmatterSchema: config.frontmatterSchema,
          transformers: config.transformers,
        })
      )
    );
    // Reject duplicate slugs / urlPaths. Without this guard, two files that
    // normalize to the same route (e.g. `guide.mdx` and `guide/index.mdx`, or
    // both `.md` and `.mdx` variants) would silently overwrite each other in
    // the slug Map below, leaving consumers with an indeterminate page.
    // `resolveDocsNavigation` already errors on this; keep the source
    // primitive consistent.
    const slugIndex = new Map<string, DocsPageMeta<TFrontmatter>>();
    const urlPathIndex = new Map<string, DocsPageMeta<TFrontmatter>>();
    for (const meta of metas) {
      const slugKey = meta.slug.join("/");
      const existingSlug = slugIndex.get(slugKey);
      if (existingSlug) {
        throw new Error(
          `Duplicate slug "/${slugKey}" — both "${existingSlug.relativePath}${existingSlug.extension}" and "${meta.relativePath}${meta.extension}" resolve to the same route. Rename one or remove it.`
        );
      }
      const existingUrl = urlPathIndex.get(meta.urlPath);
      if (existingUrl) {
        throw new Error(
          `Duplicate URL path "${meta.urlPath}" — both "${existingUrl.relativePath}${existingUrl.extension}" and "${meta.relativePath}${meta.extension}" resolve to the same route. Rename one or remove it.`
        );
      }
      slugIndex.set(slugKey, meta);
      urlPathIndex.set(meta.urlPath, meta);
    }

    cachedMetas = metas;
    cachedMetaBySlug = slugIndex;
    return cachedMetas;
  }

  async function findMetaForSlug(
    slug: string[]
  ): Promise<DocsPageMeta<TFrontmatter> | null> {
    // Ensure the slug index is populated. `listMetas()` is cached after the
    // first call so subsequent loadPage() invocations are O(1).
    await listMetas();
    return cachedMetaBySlug?.get(slug.join("/")) ?? null;
  }

  async function getNavigation(): Promise<DocsNavigation> {
    return await resolveDocsNavigation({
      srcDir: path.dirname(contentDir),
      docsDirName: path.basename(contentDir),
      baseUrl: config.baseUrl,
      groups: config.groups ?? [],
      nav,
      mounts: config.mounts,
      i18n: config.i18n,
      locale: config.locale,
      toc: tocOptions === false ? false : tocOptions,
    });
  }

  async function listPages(): Promise<DocsPageMeta<TFrontmatter>[]> {
    return await listMetas();
  }

  async function loadPage(
    slugInput: string | string[]
  ): Promise<DocsPage<TFrontmatter> | null> {
    const slug = Array.isArray(slugInput)
      ? slugInput
      : slugInput.split("/").filter(Boolean);
    const normalizedI18n = normalizeDocsI18nConfig(config.i18n);
    const localeCodes = new Set(
      normalizedI18n?.locales.map((entry) => entry.code) ?? []
    );
    const slugHasLocale = localeCodes.has(slug[0] ?? "");
    let meta = await findMetaForSlug(slug);
    if (!meta && slugHasLocale) {
      meta = await findMetaForSlug(slug.slice(1));
    }
    if (
      !meta &&
      normalizedI18n &&
      config.locale &&
      config.locale !== normalizedI18n.defaultLocale
    ) {
      meta = await findMetaForSlug([config.locale, ...slug]);
    }
    if (!meta) {
      return null;
    }

    const result = await convertMdxFile(meta.filePath, remarkPlugins, false, {
      frontmatterSchema: config.frontmatterSchema,
      transformers: config.transformers,
      transformContext: {
        filePath: meta.filePath,
        relativePath: meta.relativePath,
        urlPath: meta.urlPath,
        locale: meta.locale,
      },
    });
    const toc =
      tocOptions === false
        ? []
        : extractDocsTableOfContents(
            result.markdown,
            {
              urlPath: meta.urlPath,
              absoluteUrl: toAbsoluteUrl(meta.urlPath, baseUrl),
            },
            tocOptions
          );

    return {
      ...meta,
      frontmatter: result.data,
      markdown: result.markdown,
      ast: result.ast,
      toc,
    };
  }

  async function buildSearchIndex(): Promise<DocsSearchBundle> {
    const metas = await listMetas();
    const documents: DocsSearchDocument[] = await Promise.all(
      metas
        .filter((meta) => !meta.isFallback)
        .map(async (meta) => {
          const result = await convertMdxFile(
            meta.filePath,
            remarkPlugins,
            false,
            {
              frontmatterSchema: config.frontmatterSchema,
              transformers: config.transformers,
              transformContext: {
                filePath: meta.filePath,
                relativePath: meta.relativePath,
                urlPath: meta.urlPath,
                locale: meta.locale,
              },
            }
          );
          return {
            id: meta.urlPath,
            title: meta.title,
            description: meta.description,
            urlPath: meta.urlPath,
            absoluteUrl: toAbsoluteUrl(meta.urlPath, baseUrl),
            relativePath: meta.relativePath,
            ...(meta.locale ? { locale: meta.locale } : {}),
            ...(meta.sourceLocale ? { sourceLocale: meta.sourceLocale } : {}),
            ...(meta.isFallback === undefined
              ? {}
              : { isFallback: meta.isFallback }),
            ...(meta.logicalPath ? { logicalPath: meta.logicalPath } : {}),
            frontmatter: result.data,
            content: result.markdown,
          };
        })
    );
    const index: DocsSearchIndex = createDocsSearchIndex(documents, {
      ...config.searchIndex,
      transformers:
        config.transformers as DocsTransformerOptions["transformers"],
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

  async function resolveIncludeBound(
    specifier: string,
    options?: Partial<ResolveIncludeOptions>
  ): Promise<IncludeResolution> {
    return await resolveInclude(specifier, {
      fromDir: options?.fromDir ?? contentDir,
      basePaths: options?.basePaths,
      baseDir: options?.baseDir,
      cwd: options?.cwd,
      lang: options?.lang,
    });
  }

  return {
    contentDir,
    getNavigation,
    listPages,
    loadPage,
    buildSearchIndex,
    resolveInclude: resolveIncludeBound,
  };
}
