import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { glob as fg } from "tinyglobby";
import { type DocsI18nConfig, normalizeDocsI18nConfig } from "../i18n";
import {
  type DocsPathMount,
  normalizeBaseUrl,
  normalizeDocsPath,
  normalizeUrlPrefix,
  toAbsoluteUrl,
  toDocsUrlPath,
} from "../internal/docs-url";
import { parseFrontmatter } from "../internal/frontmatter";

const DOCS_DIRNAME = "docs";
const DEFAULT_FEED_LIMIT = 20;
const GENERATED_MARKDOWN_FILES = new Set(["sitemap.md"]);
const XML_ENTITIES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&apos;",
  "<": "&lt;",
  ">": "&gt;",
};
const XML_ESCAPE_PATTERN = /["&'<>]/g;

export type FeedFormat = "rss" | "atom";

export type DocsFeedConfig = {
  /** Stable identifier used in CLI JSON output. */
  id: string;
  /** Human-readable feed title. */
  title: string;
  /** Human-readable feed description. */
  description?: string;
  /** Select generated pages by canonical URL prefix, e.g. `/changelog`. */
  source: {
    urlPrefix: string;
  };
  /** Feed formats to emit. */
  formats: FeedFormat[];
  /** Public output URL paths for each requested format. */
  output: {
    rss?: string;
    atom?: string;
  };
  /** Maximum number of entries to include. Defaults to 20. */
  limit?: number;
};

export type FeedEntry = {
  id: string;
  title: string;
  url: string;
  urlPath: string;
  summary?: string;
  publishedAt: string;
  updatedAt: string;
};

export type RenderFeedConfig = {
  title: string;
  description?: string;
  siteUrl: string;
  feedUrl: string;
  entries: FeedEntry[];
  generatedAt?: string;
};

export type GenerateFeedArtifactsConfig = {
  outDir: string;
  baseUrl?: string;
  feeds?: DocsFeedConfig[];
  mounts?: DocsPathMount[];
  i18n?: DocsI18nConfig;
};

export type GenerateFeedArtifactsResult = {
  files: Record<string, { rss?: string; atom?: string }>;
};

type GeneratedFeedPage = FeedEntry & {
  draft: boolean;
};

function escapeXml(value: string): string {
  return value.replace(
    XML_ESCAPE_PATTERN,
    (char) => XML_ENTITIES[char] ?? char
  );
}

function normalizeDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return;
}

function readLastModified(
  frontmatter: Record<string, unknown>,
  fallback: Date
): string {
  return (
    normalizeDate(frontmatter.lastModified) ??
    normalizeDate(frontmatter.last_updated) ??
    normalizeDate(frontmatter.lastUpdated) ??
    fallback.toISOString()
  );
}

function normalizeDescription(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function titleFromRelativePath(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.md$/, "");
  const last = withoutExtension.split("/").filter(Boolean).pop() ?? "Untitled";
  const segment = last === "index" ? "Index" : last;
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isSelectedByPrefix(urlPath: string, urlPrefix: string): boolean {
  return urlPath.startsWith(`${urlPrefix}/`);
}

function compareFeedEntries(left: FeedEntry, right: FeedEntry): number {
  const byDate =
    new Date(right.publishedAt).getTime() -
    new Date(left.publishedAt).getTime();
  return byDate === 0 ? left.urlPath.localeCompare(right.urlPath) : byDate;
}

function assertValidFeedConfig(feed: DocsFeedConfig): void {
  if (feed.formats.length === 0) {
    throw new Error(`feed "${feed.id}" must request at least one format`);
  }
  for (const format of feed.formats) {
    if (format !== "rss" && format !== "atom") {
      throw new Error(
        `feed "${feed.id}" formats must contain only "rss" or "atom"`
      );
    }
  }
  for (const format of feed.formats) {
    if (!feed.output[format]) {
      throw new Error(`feed "${feed.id}" must set output.${format}`);
    }
  }
}

function resolveOutputPath(outDir: string, outputUrlPath: string): string {
  if (!outputUrlPath.startsWith("/")) {
    throw new Error(`feed output path "${outputUrlPath}" must start with "/"`);
  }
  const outputPath = path.join(
    outDir,
    normalizeDocsPath(outputUrlPath).replace(/^\/+/, "")
  );
  const relativeToOut = path.relative(outDir, outputPath);
  if (
    !relativeToOut ||
    relativeToOut.startsWith("..") ||
    path.isAbsolute(relativeToOut)
  ) {
    throw new Error(
      `feed output path "${outputUrlPath}" must resolve inside the output directory`
    );
  }
  return outputPath;
}

async function readGeneratedFeedPages(
  outDir: string,
  baseUrl: string,
  mounts?: DocsPathMount[],
  i18nConfig?: DocsI18nConfig
): Promise<GeneratedFeedPage[]> {
  const docsDir = path.join(outDir, DOCS_DIRNAME);
  if (!existsSync(docsDir)) {
    return [];
  }

  const i18n = normalizeDocsI18nConfig(i18nConfig);
  const localeCodes = new Set(i18n?.locales.map((locale) => locale.code) ?? []);
  const files = await fg("**/*.md", {
    absolute: false,
    cwd: docsDir,
    onlyFiles: true,
  });
  const pages: GeneratedFeedPage[] = [];
  for (const file of files.sort((left, right) => left.localeCompare(right))) {
    if (GENERATED_MARKDOWN_FILES.has(file)) {
      continue;
    }
    const [firstSegment] = normalizeDocsPath(file).split("/");
    if (firstSegment && localeCodes.has(firstSegment)) {
      continue;
    }
    const filePath = path.join(docsDir, file);
    const raw = await readFile(filePath, "utf8");
    const fileStat = await stat(filePath);
    const parsed = parseFrontmatter(raw);
    const urlPath = toDocsUrlPath(file, mounts);
    const title =
      String(parsed.data.title ?? "").trim() || titleFromRelativePath(file);
    const updatedAt = readLastModified(parsed.data, fileStat.mtime);
    const publishedAt = normalizeDate(parsed.data.date) ?? updatedAt;
    const summary = normalizeDescription(parsed.data.description);
    pages.push({
      id: toAbsoluteUrl(urlPath, baseUrl),
      title,
      url: toAbsoluteUrl(urlPath, baseUrl),
      urlPath,
      ...(summary ? { summary } : {}),
      publishedAt,
      updatedAt,
      draft: parsed.data.draft === true,
    });
  }
  return pages;
}

export function renderRssFeed(config: RenderFeedConfig): string {
  const description = config.description ?? `${config.title} updates.`;
  const generatedAt = config.generatedAt ?? new Date().toISOString();
  const items = config.entries.map((entry) => {
    const summary = entry.summary
      ? `      <description>${escapeXml(entry.summary)}</description>\n`
      : "";
    return [
      "    <item>",
      `      <title>${escapeXml(entry.title)}</title>`,
      `      <link>${escapeXml(entry.url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(entry.id)}</guid>`,
      `      <pubDate>${new Date(entry.publishedAt).toUTCString()}</pubDate>`,
      summary.trimEnd(),
      "    </item>",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(config.title)}</title>`,
    `    <link>${escapeXml(config.siteUrl)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>`,
    `    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${escapeXml(config.feedUrl)}" rel="self" type="application/rss+xml" />`,
    ...items,
    "  </channel>",
    "</rss>",
  ].join("\n")}\n`;
}

export function renderAtomFeed(config: RenderFeedConfig): string {
  const generatedAt = config.generatedAt ?? new Date().toISOString();
  const updatedAt =
    config.entries[0]?.updatedAt ??
    config.entries[0]?.publishedAt ??
    generatedAt;
  const entries = config.entries.map((entry) => {
    const summary = entry.summary
      ? `    <summary>${escapeXml(entry.summary)}</summary>\n`
      : "";
    return [
      "  <entry>",
      `    <id>${escapeXml(entry.id)}</id>`,
      `    <title>${escapeXml(entry.title)}</title>`,
      `    <link href="${escapeXml(entry.url)}" />`,
      `    <published>${escapeXml(entry.publishedAt)}</published>`,
      `    <updated>${escapeXml(entry.updatedAt)}</updated>`,
      summary.trimEnd(),
      "  </entry>",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(config.siteUrl)}</id>`,
    `  <title>${escapeXml(config.title)}</title>`,
    `  <updated>${escapeXml(updatedAt)}</updated>`,
    `  <link href="${escapeXml(config.siteUrl)}" />`,
    `  <link href="${escapeXml(config.feedUrl)}" rel="self" />`,
    ...entries,
    "</feed>",
  ].join("\n")}\n`;
}

export async function generateFeedArtifacts(
  config: GenerateFeedArtifactsConfig
): Promise<GenerateFeedArtifactsResult> {
  const feeds = config.feeds ?? [];
  const files: GenerateFeedArtifactsResult["files"] = {};
  if (feeds.length === 0) {
    return { files };
  }

  const outDir = path.resolve(config.outDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const pages = await readGeneratedFeedPages(
    outDir,
    baseUrl,
    config.mounts,
    config.i18n
  );

  for (const feed of feeds) {
    assertValidFeedConfig(feed);
    const sourceUrlPrefix = normalizeUrlPrefix(feed.source.urlPrefix);
    const limit = feed.limit ?? DEFAULT_FEED_LIMIT;
    const entries = pages
      .filter(
        (page) =>
          !page.draft && isSelectedByPrefix(page.urlPath, sourceUrlPrefix)
      )
      .sort(compareFeedEntries)
      .slice(0, limit);
    const siteUrl = toAbsoluteUrl(sourceUrlPrefix, baseUrl);
    const feedFiles: { rss?: string; atom?: string } = {};

    for (const format of feed.formats) {
      const outputUrlPath = feed.output[format];
      if (!outputUrlPath) {
        continue;
      }
      const outputPath = resolveOutputPath(outDir, outputUrlPath);
      const feedUrl = toAbsoluteUrl(outputUrlPath, baseUrl);
      const rendered =
        format === "rss"
          ? renderRssFeed({
              title: feed.title,
              description: feed.description,
              siteUrl,
              feedUrl,
              entries,
            })
          : renderAtomFeed({
              title: feed.title,
              description: feed.description,
              siteUrl,
              feedUrl,
              entries,
            });
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, rendered);
      feedFiles[format] = outputPath;
    }
    files[feed.id] = feedFiles;
  }

  return { files };
}
