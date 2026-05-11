import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
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
  outputFile?: string;
  contentOutputFile?: string;
  embedContent?: boolean;
  indexOptions?: CreateDocsSearchIndexOptions;
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
  baseUrl: string
): Promise<DocsSearchDocument[]> {
  const files = await collectMarkdownFiles(docsDir);
  const docs: DocsSearchDocument[] = [];

  for (const filePath of files) {
    const relativePath = normalizeDocsPath(path.relative(docsDir, filePath));
    if (GENERATED_MARKDOWN_FILES.has(relativePath)) {
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
    const urlPath = toDocsUrlPath(relativePath);
    docs.push({
      id: stripDocsExtension(relativePath),
      title,
      description,
      urlPath,
      absoluteUrl: toAbsoluteUrl(urlPath, baseUrl),
      relativePath: stripDocsExtension(relativePath),
      content: parsed.content.trim(),
    });
  }

  return docs;
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
  if (!existsSync(docsDir)) {
    throw new Error(
      `generateDocsSearchFiles found no docs directory at "${docsDir}". Run convertAllMdx first, or check config.outDir.`
    );
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const docs = await readMarkdownDocs(docsDir, baseUrl);
  if (docs.length === 0) {
    throw new Error(
      `generateDocsSearchFiles found no markdown files under "${docsDir}". Run convertAllMdx first, or check config.outDir.`
    );
  }

  const indexWithContent = createDocsSearchIndex(docs, config.indexOptions);
  const { content, ...indexWithoutContent } = indexWithContent;
  if (!content) {
    throw new Error("createDocsSearchIndex did not return a content store.");
  }
  const index = config.embedContent ? indexWithContent : indexWithoutContent;
  const outputPath = resolveDocsOutputPath(
    docsDir,
    config.outputFile,
    DEFAULT_OUTPUT_FILE
  );
  const contentOutputPath = config.embedContent
    ? undefined
    : resolveDocsOutputPath(
        docsDir,
        config.contentOutputFile,
        DEFAULT_CONTENT_OUTPUT_FILE
      );
  const serialized = `${JSON.stringify(index)}\n`;
  const serializedContent = `${JSON.stringify(content)}\n`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized);
  if (contentOutputPath) {
    await mkdir(path.dirname(contentOutputPath), { recursive: true });
    await writeFile(contentOutputPath, serializedContent);
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
