import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const DOCS_DIRNAME = "docs";
const TRAILING_SLASHES_PATTERN = /\/+$/;
const WINDOWS_PATH_PATTERN = /\\/g;
const INDEX_SEGMENT_PATTERN = /\/index$/;
const ROOT_INDEX_PATTERN = /^index$/;
const MD_EXTENSION_PATTERN = /\.(md|mdx)$/;
const MD_ONLY_EXTENSION_PATTERN = /\.md$/;
const SEPARATOR_PATTERN = /[-_]/;
const WHITESPACE_PATTERN = /\s+/g;

export type SourceDoc = {
  title: string;
  description: string;
  urlPath: string;
  absoluteUrl: string;
  relativePath: string;
};

export type MarkdownDoc = SourceDoc & {
  content: string;
};

export type CuratedLink = {
  urlPath: string;
  title?: string;
  description?: string;
};

export type CuratedSection = {
  title: string;
  description?: string;
  links: CuratedLink[];
};

export type FullTopic = {
  slug: string;
  title: string;
  description: string;
  includePrefixes: string[];
};

export type ProductInfo = {
  /** Product display name, e.g. "DSAR SDK" */
  name: string;
  /** Short one-line summary, rendered as a blockquote at the top of llms.txt */
  summary: string;
  /** Bullets rendered under "## Product Summary" */
  bullets?: string[];
  /** Curated links rendered under "## Best Starting Points" */
  bestStartingPoints?: CuratedLink[];
  /** Optional agent guidance paragraph at the bottom of llms.txt */
  agentGuidance?: string;
};

export type LLMSummariesConfig = {
  srcDir: string;
  outDir: string;
  baseUrl?: string;
  product: ProductInfo;
  /** Sections rendered in /docs/llms.txt */
  docsSections?: CuratedSection[];
};

export type LLMFullConfig = {
  outDir: string;
  baseUrl?: string;
  product: Pick<ProductInfo, "name">;
  topics: FullTopic[];
};

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

function isIncluded(relativePath: string, prefixes: string[]): boolean {
  return prefixes.some((raw) => {
    const prefix = raw.replace(TRAILING_SLASHES_PATTERN, "");
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  });
}

type RenderedLink = {
  title: string;
  absoluteUrl: string;
  description: string;
};

function renderLink(link: RenderedLink): string {
  return `- [${link.title}](${link.absoluteUrl}): ${link.description}`;
}

function renderSection(
  section: CuratedSection,
  resolvedLinks: RenderedLink[]
): string {
  const lines = [`## ${section.title}`];
  if (section.description) {
    lines.push("", section.description);
  }
  lines.push("", ...resolvedLinks.map(renderLink));
  return lines.join("\n");
}

async function collectFiles(
  rootDir: string,
  extensions: string[]
): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(absolutePath, extensions);
      }
      return extensions.includes(path.extname(entry.name))
        ? [absolutePath]
        : [];
    })
  );
  return files.flat();
}

async function readSourceDocs(
  srcDir: string,
  baseUrl: string
): Promise<Map<string, SourceDoc>> {
  const docsDir = path.join(srcDir, DOCS_DIRNAME);
  const docs = new Map<string, SourceDoc>();

  if (!existsSync(docsDir)) {
    return docs;
  }

  const files = await collectFiles(docsDir, [".md", ".mdx"]);

  const entries = await Promise.all(
    files.map(async (filePath) => {
      const relativePath = path
        .relative(docsDir, filePath)
        .replace(WINDOWS_PATH_PATTERN, "/");
      const raw = await readFile(filePath, "utf-8");
      const parsed = matter(raw);
      const title =
        String(parsed.data.title ?? "").trim() ||
        titleize(path.basename(relativePath, path.extname(relativePath))) ||
        "Untitled";
      const description = normalizeDescription(
        String(parsed.data.description ?? "")
      );
      const urlPath = toUrlPath(relativePath);
      return {
        urlPath,
        doc: {
          title,
          description,
          urlPath,
          absoluteUrl: toAbsoluteUrl(urlPath, baseUrl),
          relativePath: relativePath.replace(MD_EXTENSION_PATTERN, ""),
        },
      };
    })
  );

  for (const { urlPath, doc } of entries) {
    docs.set(urlPath, doc);
  }

  return docs;
}

async function readMarkdownDocs(
  outDir: string,
  baseUrl: string
): Promise<MarkdownDoc[]> {
  const docsDir = path.join(outDir, DOCS_DIRNAME);
  if (!existsSync(docsDir)) {
    return [];
  }

  const files = await collectFiles(docsDir, [".md"]);
  const docs = await Promise.all(
    files.map(async (filePath) => {
      const relativePath = path
        .relative(docsDir, filePath)
        .replace(WINDOWS_PATH_PATTERN, "/");
      const raw = await readFile(filePath, "utf-8");
      const parsed = matter(raw);
      const title =
        String(parsed.data.title ?? "").trim() ||
        titleize(path.basename(relativePath, ".md")) ||
        "Untitled";
      const description = normalizeDescription(
        String(parsed.data.description ?? "")
      );
      const urlPath = toUrlPath(relativePath);

      return {
        title,
        description,
        urlPath,
        absoluteUrl: toAbsoluteUrl(urlPath, baseUrl),
        relativePath: relativePath.replace(MD_ONLY_EXTENSION_PATTERN, ""),
        content: parsed.content.trim(),
      };
    })
  );

  return docs.sort((left, right) => left.urlPath.localeCompare(right.urlPath));
}

function resolveCuratedLink(
  link: CuratedLink,
  sourceDocs: Map<string, SourceDoc>,
  baseUrl: string
): RenderedLink {
  const sourceDoc = sourceDocs.get(link.urlPath);
  return {
    title:
      link.title ??
      sourceDoc?.title ??
      titleize(
        link.urlPath.split("/").filter(Boolean).at(-1) ?? "documentation"
      ),
    description:
      link.description ?? sourceDoc?.description ?? "No description provided.",
    absoluteUrl: toAbsoluteUrl(sourceDoc?.urlPath ?? link.urlPath, baseUrl),
  };
}

function renderProductSummary(
  product: ProductInfo,
  sourceDocs: Map<string, SourceDoc>,
  baseUrl: string
): string {
  const startingPoints = product.bestStartingPoints ?? [];
  const links = startingPoints.map((link) =>
    resolveCuratedLink(link, sourceDocs, baseUrl)
  );

  const sections: string[] = [`# ${product.name}`, "", `> ${product.summary}`];

  if (product.bullets && product.bullets.length > 0) {
    sections.push(
      "",
      "## Product Summary",
      "",
      ...product.bullets.map((bullet) => `- ${bullet}`)
    );
  }

  if (links.length > 0) {
    sections.push("", "## Best Starting Points", "", ...links.map(renderLink));
  }

  if (product.agentGuidance) {
    sections.push("", "## Agent Guidance", "", product.agentGuidance);
  }

  return sections.join("\n");
}

function renderDocsSummary(
  product: ProductInfo,
  sourceDocs: Map<string, SourceDoc>,
  baseUrl: string,
  docsSections: CuratedSection[]
): string {
  const sections = docsSections.map((section) =>
    renderSection(
      section,
      section.links.map((link) => resolveCuratedLink(link, sourceDocs, baseUrl))
    )
  );

  return `# ${product.name} Documentation

> Curated documentation map for developers and coding agents working with ${product.name}.

## How To Use This File

Read the summary links first. If the summary is not enough, choose the smallest relevant topic file from \`/docs/llms-full.txt\`.

${sections.join("\n\n")}`;
}

function renderDocsFullRouter(
  product: Pick<ProductInfo, "name">,
  baseUrl: string,
  topics: FullTopic[]
): string {
  const links = topics.map((topic) => ({
    title: `${topic.title} Full Context`,
    description: topic.description,
    absoluteUrl: toAbsoluteUrl(`/docs/llms-full/${topic.slug}.txt`, baseUrl),
  }));

  return [
    `# ${product.name} Documentation Full Context`,
    "",
    "> Choose the smallest topic file that matches the task.",
    "",
    "## Topics",
    "",
    ...links.map(renderLink),
  ].join("\n");
}

function renderRootFullRouter(
  product: Pick<ProductInfo, "name">,
  baseUrl: string
): string {
  return [
    `# ${product.name} Full Context Router`,
    "",
    "> Start with the product summary, then the curated docs summary, then one topic-specific full-context file if needed.",
    "",
    "## Recommended Flow",
    "",
    `- [Product Summary](${toAbsoluteUrl("/llms.txt", baseUrl)}): Short product-oriented overview of ${product.name}.`,
    `- [Documentation Summary](${toAbsoluteUrl("/docs/llms.txt", baseUrl)}): Curated docs map for implementation work.`,
    `- [Documentation Full Router](${toAbsoluteUrl("/docs/llms-full.txt", baseUrl)}): Topic-specific deep-context files.`,
  ].join("\n");
}

function renderTopicDocument(
  product: Pick<ProductInfo, "name">,
  topic: FullTopic,
  docs: MarkdownDoc[]
): string {
  const topicDocs = docs.filter((doc) =>
    isIncluded(doc.relativePath, topic.includePrefixes)
  );
  const links = topicDocs.map((doc) => ({
    title: doc.title,
    absoluteUrl: doc.absoluteUrl,
    description: doc.description || "No description provided.",
  }));
  const contentBlocks = topicDocs.map((doc) => {
    const description = doc.description ? `${doc.description}\n` : "";
    return `# ${doc.title}
URL: ${doc.absoluteUrl}
${description}
${doc.content}`.trim();
  });

  return [
    `# ${product.name} ${topic.title} Full Context`,
    "",
    `> ${topic.description}`,
    "",
    "## Included Pages",
    "",
    links.map(renderLink).join("\n"),
    "",
    "## Content",
    "",
    contentBlocks.join("\n\n"),
  ].join("\n");
}

/**
 * Generate `/llms.txt` (product summary) and `/docs/llms.txt` (curated docs
 * map) by reading frontmatter from .md/.mdx files under `{srcDir}/docs/`.
 */
export async function generateLLMSummaries(
  config: LLMSummariesConfig
): Promise<void> {
  const srcDir = path.resolve(config.srcDir);
  const outDir = path.resolve(config.outDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const sourceDocs = await readSourceDocs(srcDir, baseUrl);

  await mkdir(path.join(outDir, DOCS_DIRNAME), { recursive: true });
  await writeFile(
    path.join(outDir, "llms.txt"),
    renderProductSummary(config.product, sourceDocs, baseUrl)
  );

  if (config.docsSections && config.docsSections.length > 0) {
    await writeFile(
      path.join(outDir, DOCS_DIRNAME, "llms.txt"),
      renderDocsSummary(
        config.product,
        sourceDocs,
        baseUrl,
        config.docsSections
      )
    );
  }
}

/**
 * Generate the full-context routers and one topic-specific .txt per topic
 * under `/docs/llms-full/`. Reads generated .md files from `{outDir}/docs/`.
 */
export async function generateLLMFullFiles(
  config: LLMFullConfig
): Promise<void> {
  const outDir = path.resolve(config.outDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const markdownDocs = await readMarkdownDocs(outDir, baseUrl);

  await mkdir(path.join(outDir, DOCS_DIRNAME, "llms-full"), {
    recursive: true,
  });
  await writeFile(
    path.join(outDir, "llms-full.txt"),
    renderRootFullRouter(config.product, baseUrl)
  );
  await writeFile(
    path.join(outDir, DOCS_DIRNAME, "llms-full.txt"),
    renderDocsFullRouter(config.product, baseUrl, config.topics)
  );

  for (const topic of config.topics) {
    await writeFile(
      path.join(outDir, DOCS_DIRNAME, "llms-full", `${topic.slug}.txt`),
      renderTopicDocument(config.product, topic, markdownDocs)
    );
  }
}
