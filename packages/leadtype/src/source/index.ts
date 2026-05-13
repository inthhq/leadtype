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
 *     with `mdxSourcePlugins`; this primitive provides nav + search.
 *
 * The primitive does **no I/O on construction** beyond a directory scan for
 * `listPages()`. Page bodies are loaded on demand.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Root } from "mdast";
import { glob as fg } from "tinyglobby";
import type { PluggableList } from "unified";
import { convertMdxFile } from "../convert";
import {
  type DocsPathMount,
  normalizeBaseUrl,
  normalizeDocsPath,
  stripDocsExtension,
  toAbsoluteUrl,
  toDocsUrlPath,
} from "../internal/docs-url";
import { parseFrontmatter } from "../internal/frontmatter";
import type {
  DocsGroup,
  DocsTableOfContentsItem,
  DocsTableOfContentsOptions,
} from "../llm";
import { extractDocsTableOfContents, resolveDocsNavigation } from "../llm";
import type { DocsNavigation } from "../llm/readability";
import { mdxSourcePlugins } from "../mdx/source-preset";
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

const DOC_EXTENSIONS = [".md", ".mdx"] as const;

export type DocsPageMeta = {
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
};

export type DocsPage = DocsPageMeta & {
  /** Parsed frontmatter as a plain object. */
  frontmatter: Record<string, unknown>;
  /** Serialized markdown after the configured remark plugins ran. */
  markdown: string;
  /** mdast Root after the configured plugins ran — render this for live MDX. */
  ast: Root;
  /** Table of contents derived from the document's headings. */
  toc: DocsTableOfContentsItem[];
};

export type CreateDocsSourceConfig = {
  /** Directory containing source `.md` / `.mdx` files (e.g. `"./content/docs"`). */
  contentDir: string;
  /**
   * Optional doc-groups for navigation. When omitted, navigation is still
   * computed but `groups` will be empty (all pages appear under `ungrouped`).
   */
  groups?: DocsGroup[];
  /** Base URL for absolute links (search index, TOC anchors). */
  baseUrl?: string;
  /** Multi-mount configuration; matches `resolveDocsNavigation`. */
  mounts?: DocsPathMount[];
  /**
   * Remark plugins to apply when loading pages. Defaults to `mdxSourcePlugins`
   * (expand includes, resolve `<ExtractedTypeTable>`, strip authoring `import`s).
   * Pass `[]` to skip transforms.
   */
  remarkPlugins?: PluggableList;
  /** TOC extraction options. Pass `false` to skip TOC computation entirely. */
  toc?: DocsTableOfContentsOptions | false;
  /** Search-index tuning. */
  searchIndex?: CreateDocsSearchIndexOptions;
};

export type DocsSource = {
  /** Absolute path to the resolved docs directory. */
  contentDir: string;
  /** Compute the docs navigation from configured groups + filesystem state. */
  getNavigation(): Promise<DocsNavigation>;
  /** Enumerate every doc page found under `contentDir`. */
  listPages(): Promise<DocsPageMeta[]>;
  /**
   * Load a single page by slug. Accepts either an already-split slug array or
   * a slash-joined string. Returns `null` if no matching file exists.
   */
  loadPage(slug: string | string[]): Promise<DocsPage | null>;
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

async function readPageMeta(
  filePath: string,
  contentDir: string,
  mounts?: DocsPathMount[]
): Promise<DocsPageMeta> {
  const relativePath = normalizeDocsPath(path.relative(contentDir, filePath));
  const raw = await readFile(filePath, "utf8");
  const parsed = parseFrontmatter(raw);
  const title =
    String(parsed.data.title ?? "").trim() ||
    titleFromRelativePath(relativePath);
  const description = String(parsed.data.description ?? "").trim();
  const groups = normalizeGroupValue(parsed.data.group);
  const slug = deriveSlug(relativePath);
  const urlPath = toDocsUrlPath(relativePath, mounts);
  const extension = filePath.endsWith(".mdx") ? ".mdx" : ".md";
  return {
    slug,
    urlPath,
    relativePath: stripDocsExtension(relativePath),
    extension,
    filePath,
    title,
    description,
    groups,
  };
}

export async function createDocsSource(
  config: CreateDocsSourceConfig
): Promise<DocsSource> {
  const contentDir = path.resolve(config.contentDir);
  if (!existsSync(contentDir)) {
    throw new Error(
      `createDocsSource: contentDir does not exist at "${contentDir}"`
    );
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const remarkPlugins = config.remarkPlugins ?? mdxSourcePlugins;
  const tocOptions: DocsTableOfContentsOptions | false =
    config.toc === false ? false : (config.toc ?? {});

  let cachedFiles: string[] | null = null;
  let cachedMetas: DocsPageMeta[] | null = null;
  // Slug → meta lookup populated alongside cachedMetas so loadPage runs in O(1).
  let cachedMetaBySlug: Map<string, DocsPageMeta> | null = null;

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

  async function listMetas(): Promise<DocsPageMeta[]> {
    if (cachedMetas) {
      return cachedMetas;
    }
    const files = await listFiles();
    const metas = await Promise.all(
      files.map((filePath) => readPageMeta(filePath, contentDir, config.mounts))
    );
    cachedMetas = metas;
    cachedMetaBySlug = new Map(
      metas.map((meta) => [meta.slug.join("/"), meta])
    );
    return cachedMetas;
  }

  async function findMetaForSlug(slug: string[]): Promise<DocsPageMeta | null> {
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
      mounts: config.mounts,
      toc: tocOptions === false ? false : tocOptions,
    });
  }

  async function listPages(): Promise<DocsPageMeta[]> {
    return await listMetas();
  }

  async function loadPage(
    slugInput: string | string[]
  ): Promise<DocsPage | null> {
    const slug = Array.isArray(slugInput)
      ? slugInput
      : slugInput.split("/").filter(Boolean);
    const meta = await findMetaForSlug(slug);
    if (!meta) {
      return null;
    }

    const result = await convertMdxFile(meta.filePath, remarkPlugins);
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
      metas.map(async (meta) => {
        const result = await convertMdxFile(meta.filePath, remarkPlugins);
        return {
          id: meta.urlPath,
          title: meta.title,
          description: meta.description,
          urlPath: meta.urlPath,
          absoluteUrl: toAbsoluteUrl(meta.urlPath, baseUrl),
          relativePath: meta.relativePath,
          content: result.markdown,
        };
      })
    );
    const index: DocsSearchIndex = createDocsSearchIndex(
      documents,
      config.searchIndex
    );
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
