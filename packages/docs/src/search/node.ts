import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  type CreateSearchIndexOptions,
  createSearchIndex,
  type DocsSearchDocument,
} from "./search";

const DOCS_DIRNAME = "docs";
const DEFAULT_OUTPUT_FILE = "search-index.json";
const DEFAULT_CONTENT_OUTPUT_FILE = "search-content.json";
const WARN_INDEX_BYTES = 5 * 1024 * 1024;
const WARN_TOTAL_BYTES = 10 * 1024 * 1024;
const WARN_CHUNK_COUNT = 10_000;
const WINDOWS_PATH_PATTERN = /\\/g;
const MD_EXTENSION_PATTERN = /\.md$/;
const INDEX_SEGMENT_PATTERN = /\/index$/;
const ROOT_INDEX_PATTERN = /^index$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const SEPARATOR_PATTERN = /[-_]/;
const WHITESPACE_PATTERN = /\s+/g;
const GENERIC_DOC_TITLES = new Set(["home", "index", "readme"]);

export type GenerateSearchIndexConfig = {
  outDir: string;
  baseUrl?: string;
  outputFile?: string;
  contentOutputFile?: string;
  embedContent?: boolean;
  indexOptions?: CreateSearchIndexOptions;
};

export type GenerateSearchIndexResult = {
  outputPath: string;
  contentOutputPath?: string;
  docs: number;
  chunks: number;
  terms: number;
  indexBytes: number;
  contentBytes: number;
  bytes: number;
};

function normalizeBaseUrl(baseUrl?: string): string {
  const resolved =
    baseUrl?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined) ||
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : undefined) ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined) ||
    "http://localhost:3000";

  return resolved.replace(TRAILING_SLASHES_PATTERN, "");
}

function titleize(input: string): string {
  return input
    .split(SEPARATOR_PATTERN)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizeDescription(input: string): string {
  return input.replace(WHITESPACE_PATTERN, " ").trim();
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

function toUrlPath(relativePath: string): string {
  const normalizedPath = relativePath
    .replace(WINDOWS_PATH_PATTERN, "/")
    .replace(MD_EXTENSION_PATTERN, "")
    .replace(INDEX_SEGMENT_PATTERN, "")
    .replace(ROOT_INDEX_PATTERN, "");

  return normalizedPath.length > 0 ? `/docs/${normalizedPath}` : "/docs";
}

function toAbsoluteUrl(urlPath: string, baseUrl: string): string {
  if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) {
    return urlPath;
  }
  return `${baseUrl}${urlPath}`;
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
    const relativePath = path
      .relative(docsDir, filePath)
      .replace(WINDOWS_PATH_PATTERN, "/");
    const raw = await readFile(filePath, "utf-8");
    const parsed = matter(raw);
    const title =
      String(parsed.data.title ?? "").trim() ||
      titleFromRelativePath(relativePath);
    const description = normalizeDescription(
      String(parsed.data.description ?? "")
    );
    const urlPath = toUrlPath(relativePath);
    docs.push({
      id: relativePath.replace(MD_EXTENSION_PATTERN, ""),
      title,
      description,
      urlPath,
      absoluteUrl: toAbsoluteUrl(urlPath, baseUrl),
      relativePath: relativePath.replace(MD_EXTENSION_PATTERN, ""),
      content: parsed.content.trim(),
    });
  }

  return docs;
}

function warnIfLarge(result: GenerateSearchIndexResult): void {
  if (result.indexBytes > WARN_INDEX_BYTES) {
    process.stderr.write(
      `Search index is ${result.indexBytes} bytes, which is above the ${WARN_INDEX_BYTES} byte guidance threshold.\n`
    );
  }
  if (result.bytes > WARN_TOTAL_BYTES) {
    process.stderr.write(
      `Search index and content are ${result.bytes} bytes, which is above the ${WARN_TOTAL_BYTES} byte guidance threshold.\n`
    );
  }
  if (result.chunks > WARN_CHUNK_COUNT) {
    process.stderr.write(
      `Search index has ${result.chunks} chunks, which is above the ${WARN_CHUNK_COUNT} chunk guidance threshold.\n`
    );
  }
}

export async function generateSearchIndex(
  config: GenerateSearchIndexConfig
): Promise<GenerateSearchIndexResult> {
  const outDir = path.resolve(config.outDir);
  const docsDir = path.join(outDir, DOCS_DIRNAME);
  if (!existsSync(docsDir)) {
    throw new Error(
      `generateSearchIndex found no docs directory at "${docsDir}". Run convertAllMdx first, or check config.outDir.`
    );
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const docs = await readMarkdownDocs(docsDir, baseUrl);
  const indexWithContent = createSearchIndex(docs, config.indexOptions);
  const { content, ...indexWithoutContent } = indexWithContent;
  if (!content) {
    throw new Error("createSearchIndex did not return a content store.");
  }
  const index = config.embedContent ? indexWithContent : indexWithoutContent;
  const outputPath = path.join(
    docsDir,
    config.outputFile ?? DEFAULT_OUTPUT_FILE
  );
  const contentOutputPath = config.embedContent
    ? undefined
    : path.join(
        docsDir,
        config.contentOutputFile ?? DEFAULT_CONTENT_OUTPUT_FILE
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
