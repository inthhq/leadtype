import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  type DocsI18nConfig,
  type LocaleCode,
  logicalPathFromLocaleRelativePath,
  normalizeDocsI18nConfig,
  outputRelativePathForLocale,
  toLocalizedDocsUrlPath,
} from "../i18n";
import { writeFileAtomic } from "../internal/atomic-fs";
import {
  type DocsPathMount,
  GENERIC_DOC_TITLES,
  normalizeBaseUrl,
  normalizeWhitespace as normalizeDescription,
  normalizeDocsPath,
  stripDocsExtension,
  toAbsoluteUrl,
  toDocsUrlPath,
} from "../internal/docs-url";
import { parseFrontmatter } from "../internal/frontmatter";
import { logger } from "../internal/logger";
import type { DocsTransformerOptions } from "../transformers";
import {
  type CreateDocsSearchIndexOptions,
  createDocsSearchIndex,
  type DocsSearchDocument,
} from "./search";

const DOCS_DIRNAME = "docs";
const GENERATED_MARKDOWN_FILES = new Set(["sitemap.md"]);
const DEFAULT_OUTPUT_FILE = "search-index.json";
const DEFAULT_CONTENT_OUTPUT_FILE = "search-content.json";
const WARN_INDEX_BYTES = 5 * 1024 * 1024;
const WARN_TOTAL_BYTES = 10 * 1024 * 1024;
const WARN_CHUNK_COUNT = 10_000;
const SEPARATOR_PATTERN = /[-_]/;

export type GenerateDocsSearchFilesConfig = {
  outDir: string;
  baseUrl?: string;
  mounts?: DocsPathMount[];
  i18n?: DocsI18nConfig;
  locale?: LocaleCode;
  outputFile?: string;
  contentOutputFile?: string;
  embedContent?: boolean;
  indexOptions?: CreateDocsSearchIndexOptions;
  transformers?: DocsTransformerOptions["transformers"];
};

export type GenerateDocsSearchFilesResult = {
  outputPath: string;
  contentOutputPath?: string;
  docs: number;
  chunks: number;
  terms: number;
  indexBytes: number;
  contentBytes: number;
  bytes: number;
};

function titleize(input: string): string {
  return input
    .split(SEPARATOR_PATTERN)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function titleFromRelativePath(relativePath: string): string {
  const fileName = path.basename(relativePath, ".md");
  const parentSegment = path.basename(path.dirname(relativePath));
  const segment =
    GENERIC_DOC_TITLES.has(fileName.toLowerCase()) &&
    parentSegment &&
    parentSegment !== "."
      ? parentSegment
      : fileName;

  return titleize(segment || "documentation");
}

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return collectMarkdownFiles(absolutePath);
      }
      return path.extname(entry.name) === ".md" ? [absolutePath] : [];
    })
  );
  return files.flat().sort((left, right) => left.localeCompare(right));
}

async function readMarkdownDocs(
  docsDir: string,
  baseUrl: string,
  mounts?: DocsPathMount[],
  i18nConfig?: DocsI18nConfig,
  requestedLocale?: LocaleCode
): Promise<DocsSearchDocument[]> {
  const files = await collectMarkdownFiles(docsDir);
  const i18n = normalizeDocsI18nConfig(i18nConfig);
  const locale = requestedLocale ?? i18n?.defaultLocale;
  const selectedFiles = selectMarkdownFiles(files, docsDir, i18nConfig, locale);
  const docs: DocsSearchDocument[] = [];

  for (const file of selectedFiles) {
    const filePath = file.filePath;
    const relativePath = normalizeDocsPath(path.relative(docsDir, filePath));
    if (
      GENERATED_MARKDOWN_FILES.has(relativePath) ||
      GENERATED_MARKDOWN_FILES.has(path.basename(relativePath))
    ) {
      continue;
    }
    const raw = await readFile(filePath, "utf-8");
    const parsed = parseFrontmatter(raw);
    const title =
      String(parsed.data.title ?? "").trim() ||
      titleFromRelativePath(relativePath);
    const description = normalizeDescription(
      String(parsed.data.description ?? "")
    );
    const urlPath =
      i18n && locale
        ? toLocalizedDocsUrlPath(`${file.logicalPath}.md`, locale, i18n, mounts)
        : toDocsUrlPath(relativePath, mounts);
    docs.push({
      id: urlPath,
      title,
      description,
      urlPath,
      absoluteUrl: toAbsoluteUrl(urlPath, baseUrl),
      relativePath: file.outputRelativePath,
      frontmatter: parsed.data,
      ...(file.locale ? { locale: file.locale } : {}),
      ...(file.sourceLocale ? { sourceLocale: file.sourceLocale } : {}),
      ...(file.logicalPath ? { logicalPath: file.logicalPath } : {}),
      content: parsed.content.trim(),
    });
  }

  return docs;
}

type SelectedMarkdownFile = {
  filePath: string;
  logicalPath: string;
  outputRelativePath: string;
  locale?: LocaleCode;
  sourceLocale?: LocaleCode;
};

function selectMarkdownFiles(
  files: string[],
  docsDir: string,
  i18nConfig?: DocsI18nConfig,
  requestedLocale?: LocaleCode
): SelectedMarkdownFile[] {
  const i18n = normalizeDocsI18nConfig(i18nConfig);
  if (!(i18n && requestedLocale)) {
    return files.map((filePath) => {
      const relativePath = normalizeDocsPath(path.relative(docsDir, filePath));
      return {
        filePath,
        logicalPath: stripDocsExtension(relativePath),
        outputRelativePath: stripDocsExtension(relativePath),
      };
    });
  }

  const localeCodes = new Set(i18n.locales.map((entry) => entry.code));
  const byLogicalPath = new Map<
    string,
    Map<LocaleCode, SelectedMarkdownFile>
  >();
  for (const filePath of files) {
    const relativePath = normalizeDocsPath(path.relative(docsDir, filePath));
    const { logicalPath, sourceLocale } = logicalPathFromLocaleRelativePath(
      relativePath,
      localeCodes
    );
    const resolvedLocale = sourceLocale ?? i18n.defaultLocale;
    const localeFiles = byLogicalPath.get(logicalPath) ?? new Map();
    localeFiles.set(resolvedLocale, {
      filePath,
      logicalPath,
      outputRelativePath: outputRelativePathForLocale(
        logicalPath,
        requestedLocale,
        i18nConfig
      ),
      locale: requestedLocale,
      sourceLocale: resolvedLocale,
    });
    byLogicalPath.set(logicalPath, localeFiles);
  }

  return Array.from(byLogicalPath.values())
    .flatMap((localeFiles) => {
      const direct = localeFiles.get(requestedLocale);
      return direct ? [direct] : [];
    })
    .sort((left, right) =>
      left.outputRelativePath.localeCompare(right.outputRelativePath)
    );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function warnIfLarge(result: GenerateDocsSearchFilesResult): void {
  const overIndex = result.indexBytes > WARN_INDEX_BYTES;
  const overTotal = result.bytes > WARN_TOTAL_BYTES;
  const overChunks = result.chunks > WARN_CHUNK_COUNT;
  if (!(overIndex || overTotal || overChunks)) {
    return;
  }
  const breaches: string[] = [];
  if (overIndex) {
    breaches.push(
      `index ${formatBytes(result.indexBytes)} exceeds ${formatBytes(WARN_INDEX_BYTES)}`
    );
  }
  if (overTotal) {
    breaches.push(
      `total ${formatBytes(result.bytes)} exceeds ${formatBytes(WARN_TOTAL_BYTES)}`
    );
  }
  if (overChunks) {
    breaches.push(`chunks ${result.chunks} exceeds ${WARN_CHUNK_COUNT}`);
  }
  logger.warn({
    human: {
      message: `search index size: ${breaches.join("; ")}`,
      hint: "consider --include / --exclude to scope the index",
    },
    json: {
      event: "search.index.size",
      fields: {
        indexBytes: result.indexBytes,
        totalBytes: result.bytes,
        chunks: result.chunks,
        indexThreshold: WARN_INDEX_BYTES,
        totalThreshold: WARN_TOTAL_BYTES,
        chunksThreshold: WARN_CHUNK_COUNT,
      },
    },
  });
}

function resolveDocsOutputPath(
  docsDir: string,
  configuredPath: string | undefined,
  defaultPath: string
): string {
  const outputPath = path.resolve(docsDir, configuredPath ?? defaultPath);
  const relativePath = path.relative(docsDir, outputPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `Search output file "${configuredPath ?? defaultPath}" must stay inside "${docsDir}".`
    );
  }
  return outputPath;
}

export async function generateDocsSearchFiles(
  config: GenerateDocsSearchFilesConfig
): Promise<GenerateDocsSearchFilesResult> {
  const outDir = path.resolve(config.outDir);
  const docsDir = path.join(outDir, DOCS_DIRNAME);
  const i18n = normalizeDocsI18nConfig(config.i18n);
  const locale = config.locale ?? i18n?.defaultLocale;
  const outputDocsDir =
    i18n && locale && locale !== i18n.defaultLocale
      ? path.join(docsDir, locale)
      : docsDir;
  if (!existsSync(docsDir)) {
    throw new Error(
      `generateDocsSearchFiles found no docs directory at "${docsDir}". Run convertAllMdx first, or check config.outDir.`
    );
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const docs = await readMarkdownDocs(
    docsDir,
    baseUrl,
    config.mounts,
    config.i18n,
    locale
  );
  if (docs.length === 0) {
    throw new Error(
      `generateDocsSearchFiles found no markdown files under "${docsDir}". Run convertAllMdx first, or check config.outDir.`
    );
  }

  const indexWithContent = createDocsSearchIndex(docs, {
    ...config.indexOptions,
    transformers: config.transformers,
  });
  const { content, ...indexWithoutContent } = indexWithContent;
  if (!content) {
    throw new Error("createDocsSearchIndex did not return a content store.");
  }
  const index = config.embedContent ? indexWithContent : indexWithoutContent;
  const outputPath = resolveDocsOutputPath(
    outputDocsDir,
    config.outputFile,
    DEFAULT_OUTPUT_FILE
  );
  const contentOutputPath = config.embedContent
    ? undefined
    : resolveDocsOutputPath(
        outputDocsDir,
        config.contentOutputFile,
        DEFAULT_CONTENT_OUTPUT_FILE
      );
  const serialized = `${JSON.stringify(index)}\n`;
  const serializedContent = `${JSON.stringify(content)}\n`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFileAtomic(outputPath, serialized);
  if (contentOutputPath) {
    await mkdir(path.dirname(contentOutputPath), { recursive: true });
    await writeFileAtomic(contentOutputPath, serializedContent);
  }

  const indexBytes = Buffer.byteLength(serialized, "utf-8");
  const contentBytes = contentOutputPath
    ? Buffer.byteLength(serializedContent, "utf-8")
    : 0;
  const result = {
    outputPath,
    contentOutputPath,
    docs: docs.length,
    chunks: index.chunks.length,
    terms: Object.keys(index.terms).length,
    indexBytes,
    contentBytes,
    bytes: indexBytes + contentBytes,
  };
  warnIfLarge(result);
  return result;
}
