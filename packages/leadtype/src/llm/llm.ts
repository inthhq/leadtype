import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  GENERIC_DOC_TITLES,
  normalizeBaseUrl,
  normalizeWhitespace as normalizeDescription,
  normalizeDocsPath,
  stripDocsExtension,
  toAbsoluteUrl,
  toMarkdownUrlPath,
  toDocsUrlPath as toUrlPath,
} from "../internal/docs-url";
import {
  type AgentReadabilityManifest,
  type AgentReadabilityPage,
  type DocsNavigation,
  type DocsNavigationGroup,
  type DocsNavigationPage,
  renderRobotsTxt,
  renderSitemapMarkdown,
  renderSitemapXml,
} from "./readability";

const DOCS_DIRNAME = "docs";
const AGENT_READABILITY_MANIFEST_FILE = "agent-readability.json";
const ROBOTS_FILE = "robots.txt";
const SITEMAP_MARKDOWN_FILE = "sitemap.md";
const SITEMAP_XML_FILE = "sitemap.xml";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

function assertValidGroupSlug(slug: string, parentPath: string[]): string {
  if (!SLUG_PATTERN.test(slug)) {
    const scope = parentPath.join("/") || "root";
    throw new Error(
      `Invalid group slug "${slug}" under "${scope}". Slugs must be URL-safe (alphanumerics and dashes).`
    );
  }
  return slug;
}
const MD_ONLY_EXTENSION_PATTERN = /\.md$/;
const GENERATED_MARKDOWN_FILES = new Set([SITEMAP_MARKDOWN_FILE]);
const SEPARATOR_PATTERN = /[-_]/;

export type SourceDoc = {
  title: string;
  description: string;
  urlPath: string;
  absoluteUrl: string;
  relativePath: string;
  /** Group slugs declared in frontmatter `group:`. Empty array = ungrouped. */
  groups: string[];
};

export type MarkdownDoc = SourceDoc & {
  content: string;
  lastModified: string;
};

export type CuratedLink = {
  urlPath: string;
  title?: string;
  description?: string;
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

/**
 * One entry in a docs navigation group tree. A group with `children` is a
 * router (parent); a group without `children` is a leaf and can directly
 * contain pages whose frontmatter `group:` matches its slug.
 */
export type DocsGroup = {
  slug: string;
  title: string;
  description?: string;
  children?: DocsGroup[];
};

/**
 * Combined config for the `leadtype` docs-generation pipeline. Pass to
 * `defineDocsConfig` in a `docs.config.ts` file. Pages declare which group
 * they belong to via MDX frontmatter (`group: <slug>` or `group: [a, b]`),
 * so this config only describes the structure and metadata of groups, not
 * per-page membership.
 */
export type DocsConfig = {
  product: ProductInfo;
  groups: DocsGroup[];
};

/**
 * Identity helper that gives the config object full IDE autocomplete and
 * type-checks the docs structure at edit time.
 */
export function defineDocsConfig(config: DocsConfig): DocsConfig {
  return config;
}

export type LlmsTxtConfig = {
  srcDir: string;
  outDir: string;
  baseUrl?: string;
  product: ProductInfo;
  /** Group tree from `docs.config.ts`. Used for `/docs/llms.txt` sections. */
  groups: DocsGroup[];
};

export type LLMFullContextConfig = {
  outDir: string;
  baseUrl?: string;
  product: Pick<ProductInfo, "name">;
  /** Group tree from `docs.config.ts`. Preserved for config validation. */
  groups: DocsGroup[];
};

export type AgentReadabilityConfig = {
  outDir: string;
  baseUrl?: string;
  product: Pick<ProductInfo, "name" | "summary">;
  groups: DocsGroup[];
};

export type AgentReadabilityResult = {
  manifest: AgentReadabilityManifest;
  files: {
    manifest: string;
    robotsTxt: string;
    sitemapMd: string;
    sitemapXml: string;
  };
};

export type ResolveDocsNavigationConfig = {
  srcDir: string;
  baseUrl?: string;
  groups: DocsGroup[];
};

type ResolvedGroup = {
  slug: string;
  slugKey: string;
  title: string;
  description?: string;
  segmentPath: string[];
  parent: ResolvedGroup | null;
  children: ResolvedGroup[];
};

function resolveGroups(
  groups: DocsGroup[],
  parentPath: string[] = [],
  parent: ResolvedGroup | null = null
): ResolvedGroup[] {
  const seen = new Set<string>();
  return groups.map((group) => {
    const slug = assertValidGroupSlug(group.slug, parentPath);
    const slugKey = slug.toLowerCase();
    if (seen.has(slugKey)) {
      const scope = parentPath.join("/") || "root";
      throw new Error(
        `Duplicate group slug "${slug}" under "${scope}". Group slugs must be unique among siblings.`
      );
    }
    seen.add(slugKey);

    const segmentPath = [...parentPath, slug];
    const resolved: ResolvedGroup = {
      slug,
      slugKey,
      title: group.title,
      description: group.description,
      segmentPath,
      parent,
      children: [],
    };
    resolved.children = resolveGroups(
      group.children ?? [],
      segmentPath,
      resolved
    );
    return resolved;
  });
}

function flattenGroups(groups: ResolvedGroup[]): ResolvedGroup[] {
  const result: ResolvedGroup[] = [];
  for (const group of groups) {
    result.push(group);
    if (group.children.length > 0) {
      result.push(...flattenGroups(group.children));
    }
  }
  return result;
}

function titleize(input: string): string {
  return input
    .split(SEPARATOR_PATTERN)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function titleFromRelativePath(
  relativePath: string,
  extension: ".md" | ".mdx"
): string {
  const fileName = path.basename(relativePath, extension);
  const parentSegment = path.basename(path.dirname(relativePath));
  let segment = fileName;

  if (GENERIC_DOC_TITLES.has(fileName.toLowerCase())) {
    segment =
      parentSegment && parentSegment !== "." ? parentSegment : "documentation";
  }

  return titleize(segment);
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

function normalizeGroupValue(raw: unknown): string[] {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(raw)) {
    const normalized: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") {
        continue;
      }
      const trimmed = item.trim();
      if (trimmed) {
        normalized.push(trimmed);
      }
    }
    return normalized;
  }
  return [];
}

type RenderedLink = {
  title: string;
  url: string;
  description: string;
};

function renderLink(link: RenderedLink): string {
  return `- [${link.title}](${link.url}): ${link.description}`;
}

function pageToRenderedLink(doc: SourceDoc): RenderedLink {
  const title =
    doc.title && !GENERIC_DOC_TITLES.has(doc.title.toLowerCase())
      ? doc.title
      : titleize(doc.relativePath.split("/").pop() ?? "Documentation");
  const description =
    normalizeDescription(doc.description) ||
    `Reference page for ${title.toLowerCase()}.`;
  return {
    title,
    description,
    url: toMarkdownUrlPath(doc.urlPath),
  };
}

function resolveCuratedLink(
  link: CuratedLink,
  sourceDocs: Map<string, SourceDoc>
): RenderedLink {
  const sourceDoc = sourceDocs.get(link.urlPath);
  const title =
    link.title ??
    (sourceDoc?.title && !GENERIC_DOC_TITLES.has(sourceDoc.title.toLowerCase())
      ? sourceDoc.title
      : titleize(
          link.urlPath.split("/").filter(Boolean).pop() ?? "Documentation"
        ));
  const description =
    link.description ??
    normalizeDescription(sourceDoc?.description ?? "") ??
    `Entry point for ${title} documentation.`;
  return {
    title,
    description: description || `Entry point for ${title} documentation.`,
    url: toMarkdownUrlPath(sourceDoc?.urlPath ?? link.urlPath),
  };
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
      const relativePath = normalizeDocsPath(path.relative(docsDir, filePath));
      const raw = await readFile(filePath, "utf-8");
      const parsed = matter(raw);
      const title =
        String(parsed.data.title ?? "").trim() ||
        titleFromRelativePath(
          relativePath,
          path.extname(relativePath) as ".md" | ".mdx"
        ) ||
        "Untitled";
      const description = normalizeDescription(
        String(parsed.data.description ?? "")
      );
      const urlPath = toUrlPath(relativePath);
      const groups = normalizeGroupValue(parsed.data.group);
      return {
        urlPath,
        doc: {
          title,
          description,
          urlPath,
          absoluteUrl: toAbsoluteUrl(urlPath, baseUrl),
          relativePath: stripDocsExtension(relativePath),
          groups,
        },
      };
    })
  );

  for (const { urlPath, doc } of entries) {
    const existing = docs.get(urlPath);
    if (existing) {
      throw new Error(
        `Duplicate documentation route "${urlPath}" — both "${existing.relativePath}" and "${doc.relativePath}" normalize to the same path.`
      );
    }
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
      const relativePath = normalizeDocsPath(path.relative(docsDir, filePath));
      const raw = await readFile(filePath, "utf-8");
      const fileStat = await stat(filePath);
      const parsed = matter(raw);
      const title =
        String(parsed.data.title ?? "").trim() ||
        titleFromRelativePath(relativePath, ".md") ||
        "Untitled";
      const description = normalizeDescription(
        String(parsed.data.description ?? "")
      );
      const urlPath = toUrlPath(relativePath);
      const groups = normalizeGroupValue(parsed.data.group);

      return {
        title,
        description,
        urlPath,
        absoluteUrl: toAbsoluteUrl(urlPath, baseUrl),
        relativePath: relativePath.replace(MD_ONLY_EXTENSION_PATTERN, ""),
        groups,
        content: parsed.content.trim(),
        lastModified: readLastModified(parsed.data, fileStat.mtime),
      };
    })
  );

  return docs
    .filter((doc) => !GENERATED_MARKDOWN_FILES.has(`${doc.relativePath}.md`))
    .sort((left, right) => left.urlPath.localeCompare(right.urlPath));
}

type GroupMembership = {
  /** Map from group slug (lowercased) → pages whose `group:` lists that slug. */
  byGroupSlug: Map<string, SourceDoc[]>;
  /** Pages whose frontmatter has no `group:`. */
  ungrouped: SourceDoc[];
  /** Pages that named a group slug not present in the config. */
  unknown: { page: SourceDoc; slug: string }[];
};

function buildGroupMembership(
  pages: SourceDoc[],
  resolved: ResolvedGroup[]
): GroupMembership {
  const all = flattenGroups(resolved);
  const known = new Map(all.map((g) => [g.slugKey, g]));
  const byGroupSlug = new Map<string, SourceDoc[]>();
  const ungrouped: SourceDoc[] = [];
  const unknown: { page: SourceDoc; slug: string }[] = [];

  // Stable page order: by urlPath. Inputs are already iteration-order-stable
  // when they come from a Map in insertion order, but explicit sort makes
  // the rendered llms.txt deterministic regardless of source.
  const ordered = [...pages].sort((left, right) =>
    left.urlPath.localeCompare(right.urlPath)
  );

  for (const page of ordered) {
    if (page.groups.length === 0) {
      ungrouped.push(page);
      continue;
    }
    let matchedAny = false;
    for (const slug of page.groups) {
      const slugKey = slug.toLowerCase();
      if (!known.has(slugKey)) {
        unknown.push({ page, slug });
        continue;
      }
      const list = byGroupSlug.get(slugKey) ?? [];
      list.push(page);
      byGroupSlug.set(slugKey, list);
      matchedAny = true;
    }
    if (!matchedAny) {
      ungrouped.push(page);
    }
  }

  return { byGroupSlug, ungrouped, unknown };
}

/** Pages whose `group:` includes the slug of `target` or any descendant. */
function pagesUnderGroup(
  target: ResolvedGroup,
  membership: GroupMembership
): SourceDoc[] {
  const seen = new Set<string>();
  const collected: SourceDoc[] = [];
  const stack = [target, ...flattenGroups(target.children)];
  for (const group of stack) {
    const list = membership.byGroupSlug.get(group.slugKey) ?? [];
    for (const page of list) {
      if (seen.has(page.urlPath)) {
        continue;
      }
      seen.add(page.urlPath);
      collected.push(page);
    }
  }
  return collected;
}

function renderProductSummary(
  product: ProductInfo,
  sourceDocs: Map<string, SourceDoc>
): string {
  const startingPoints = product.bestStartingPoints ?? [];
  const links = startingPoints.map((link) =>
    resolveCuratedLink(link, sourceDocs)
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
  resolved: ResolvedGroup[],
  membership: GroupMembership
): string {
  const renderedSections: string[] = [];
  for (const group of resolved) {
    const pages = pagesUnderGroup(group, membership);
    if (pages.length === 0) {
      continue;
    }
    const lines: string[] = [`## ${group.title}`];
    if (group.description) {
      lines.push("", group.description);
    }
    lines.push("", ...pages.map(pageToRenderedLink).map(renderLink));
    renderedSections.push(lines.join("\n"));
  }

  if (membership.ungrouped.length > 0) {
    const lines = ["## Other"];
    lines.push(
      "",
      ...membership.ungrouped.map(pageToRenderedLink).map(renderLink)
    );
    renderedSections.push(lines.join("\n"));
  }

  return `# ${product.name} Documentation

> Curated documentation map for developers and coding agents working with ${product.name}.

## How To Use This File

Read the summary links first. If the page links are not enough, use \`/llms-full.txt\` as the broad full-context fallback.

${renderedSections.join("\n\n")}`;
}

function stripLeadingTitleHeading(content: string, title: string): string {
  const lines = content.split("\n");
  if ((lines[0] ?? "").trim() === `# ${title}`) {
    return lines.slice(1).join("\n").trimStart();
  }
  return content;
}

function renderFullContextDocument(
  product: Pick<ProductInfo, "name">,
  pages: MarkdownDoc[]
): string {
  const links = pages.map((doc) => ({
    title: doc.title,
    url: doc.absoluteUrl,
    description:
      doc.description || `Entry point for ${doc.title} documentation.`,
  }));
  const contentBlocks = pages.map((doc) => {
    const description = doc.description ? `${doc.description}\n` : "";
    const content = stripLeadingTitleHeading(doc.content, doc.title);
    return `# ${doc.title}
URL: ${doc.absoluteUrl}
${description}
${content}`.trim();
  });

  return [
    `# ${product.name} Full Context`,
    "",
    "> All generated markdown documentation pages flattened into one file.",
    "",
    "## Included Pages",
    "",
    links.length > 0
      ? links.map(renderLink).join("\n")
      : "_No generated documentation pages were found._",
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
export async function generateLlmsTxt(config: LlmsTxtConfig): Promise<void> {
  const srcDir = path.resolve(config.srcDir);
  const outDir = path.resolve(config.outDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const sourceDocs = await readSourceDocs(srcDir, baseUrl);

  const resolved = resolveGroups(config.groups);
  const membership = buildGroupMembership([...sourceDocs.values()], resolved);

  await mkdir(path.join(outDir, DOCS_DIRNAME), { recursive: true });
  await writeFile(
    path.join(outDir, "llms.txt"),
    renderProductSummary(config.product, sourceDocs)
  );

  if (resolved.length > 0) {
    await writeFile(
      path.join(outDir, DOCS_DIRNAME, "llms.txt"),
      renderDocsSummary(config.product, resolved, membership)
    );
  }
}

/**
 * Generate the root `/llms-full.txt` full-context file. Reads generated .md
 * files from `{outDir}/docs/`.
 */
export async function generateLLMFullContextFiles(
  config: LLMFullContextConfig
): Promise<void> {
  const outDir = path.resolve(config.outDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const markdownDocs = await readMarkdownDocs(outDir, baseUrl);

  if (markdownDocs.length === 0) {
    throw new Error(
      `generateLLMFullContextFiles found no markdown under "${path.join(outDir, DOCS_DIRNAME)}". Run convertAllMdx first, or check that config.outDir matches.`
    );
  }

  resolveGroups(config.groups);

  const llmsFullDir = path.join(outDir, DOCS_DIRNAME, "llms-full");
  await rm(llmsFullDir, { recursive: true, force: true });
  await rm(path.join(outDir, DOCS_DIRNAME, "llms-full.txt"), { force: true });
  await writeFile(
    path.join(outDir, "llms-full.txt"),
    renderFullContextDocument(config.product, markdownDocs)
  );
}

function toAgentReadabilityPage(
  doc: MarkdownDoc,
  baseUrl: string
): AgentReadabilityPage {
  const markdownUrlPath = toMarkdownUrlPath(doc.urlPath);
  return {
    title: doc.title,
    description: doc.description,
    urlPath: doc.urlPath,
    absoluteUrl: doc.absoluteUrl,
    markdownUrlPath,
    markdownAbsoluteUrl: toAbsoluteUrl(markdownUrlPath, baseUrl),
    relativePath: doc.relativePath,
    groups: [...doc.groups],
    lastModified: doc.lastModified,
  };
}

function buildNavigationFromMarkdownDocs(
  docs: MarkdownDoc[],
  resolved: ResolvedGroup[]
): DocsNavigation {
  const membership = buildGroupMembership(docs, resolved);
  return {
    groups: resolved.map((group) => buildNavigationGroup(group, membership)),
    ungrouped: membership.ungrouped.map(pageView),
    unknown: membership.unknown.map(({ page, slug }) => ({
      urlPath: page.urlPath,
      slug,
    })),
  };
}

/**
 * Generate docs-scoped Vercel Agent Readability discovery artifacts. These
 * files are intentionally written under `/docs/` so host apps can merge them
 * with blog, marketing, changelog, or product pages before serving root-level
 * `/sitemap.xml`, `/sitemap.md`, and `/robots.txt`.
 */
export async function generateAgentReadabilityArtifacts(
  config: AgentReadabilityConfig
): Promise<AgentReadabilityResult> {
  const outDir = path.resolve(config.outDir);
  const docsDir = path.join(outDir, DOCS_DIRNAME);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const markdownDocs = await readMarkdownDocs(outDir, baseUrl);

  if (markdownDocs.length === 0) {
    throw new Error(
      `generateAgentReadabilityArtifacts found no markdown under "${docsDir}". Run convertAllMdx first, or check that config.outDir matches.`
    );
  }

  const resolved = resolveGroups(config.groups);
  const navigation = buildNavigationFromMarkdownDocs(markdownDocs, resolved);
  const pages = markdownDocs.map((doc) => toAgentReadabilityPage(doc, baseUrl));
  const manifest: AgentReadabilityManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    baseUrl,
    product: config.product,
    pages,
    navigation,
    files: {
      robotsTxt: `/docs/${ROBOTS_FILE}`,
      sitemapMd: `/docs/${SITEMAP_MARKDOWN_FILE}`,
      sitemapXml: `/docs/${SITEMAP_XML_FILE}`,
    },
  };

  const files = {
    manifest: path.join(docsDir, AGENT_READABILITY_MANIFEST_FILE),
    robotsTxt: path.join(docsDir, ROBOTS_FILE),
    sitemapMd: path.join(docsDir, SITEMAP_MARKDOWN_FILE),
    sitemapXml: path.join(docsDir, SITEMAP_XML_FILE),
  };

  await mkdir(docsDir, { recursive: true });
  await writeFile(files.sitemapXml, renderSitemapXml(pages));
  await writeFile(
    files.sitemapMd,
    renderSitemapMarkdown({
      product: config.product,
      navigation,
      pages,
    })
  );
  await writeFile(
    files.robotsTxt,
    renderRobotsTxt({
      baseUrl,
      sitemapUrlPath: "/docs/sitemap.xml",
    })
  );
  await writeFile(files.manifest, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    files,
    manifest,
  };
}

/* ---------------- AGENTS.md (offline package bundle) -------------------- */

export type AgentsMdConfig = {
  /** Repo root containing the `docs/` source. */
  srcDir: string;
  /** Output root. AGENTS.md is written at `<outDir>/AGENTS.md`. */
  outDir: string;
  product: ProductInfo;
  /** Group tree from `docs.config.ts`. Drives section structure. */
  groups: DocsGroup[];
  /**
   * Subdirectory under `outDir` that holds the converted `.md` files.
   * Used for the relative-path prefix in every link. Default: `docs`.
   */
  docsSubdir?: string;
};

export type AgentsMdResult = {
  outputPath: string;
};

function relativeDocLink(relativePath: string, docsSubdir: string): string {
  return `./${docsSubdir}/${relativePath}.md`;
}

function pageDescription(doc: SourceDoc, fallback?: string): string {
  return (
    normalizeDescription(doc.description) ||
    fallback ||
    `Reference page for ${doc.title.toLowerCase()}.`
  );
}

/**
 * Generate `AGENTS.md` at the package root for offline-readable docs that
 * coding agents auto-discover (Claude Code, Codex, Cursor, etc.). Unlike
 * `generateLlmsTxt`, every link is a **relative** filesystem path
 * (`./docs/<segment>/<slug>.md`) so the file works inside a published npm
 * tarball at `node_modules/<pkg>/AGENTS.md`.
 */
export async function generateAgentsMd(
  config: AgentsMdConfig
): Promise<AgentsMdResult> {
  const srcDir = path.resolve(config.srcDir);
  const outDir = path.resolve(config.outDir);
  const docsSubdir = config.docsSubdir ?? DOCS_DIRNAME;
  // baseUrl is required by readSourceDocs for the SourceDoc.absoluteUrl
  // field, but AGENTS.md output never reads that field — relative paths only.
  // Pass through any configured fallback so SourceDoc objects are well-formed.
  const baseUrl = normalizeBaseUrl(undefined);
  const sourceDocs = await readSourceDocs(srcDir, baseUrl);
  const resolved = resolveGroups(config.groups);
  const membership = buildGroupMembership([...sourceDocs.values()], resolved);

  const lines: string[] = [
    `# ${config.product.name}`,
    "",
    `> ${config.product.summary}`,
    "",
    "These docs ship inside the package so coding agents can read them offline. Open the topic file you need from the list below — paths are relative to this file.",
  ];

  if (config.product.bullets && config.product.bullets.length > 0) {
    lines.push("", "## Product Summary", "");
    for (const bullet of config.product.bullets) {
      lines.push(`- ${bullet}`);
    }
  }

  const startingPoints = config.product.bestStartingPoints ?? [];
  const renderedStarts: string[] = [];
  for (const link of startingPoints) {
    const sourceDoc = sourceDocs.get(link.urlPath);
    if (!sourceDoc) {
      // bestStartingPoints can reference URLs not present in source (e.g.
      // /docs root). Skip those rather than emit a broken relative link.
      continue;
    }
    const title = link.title ?? sourceDoc.title;
    const description = link.description ?? pageDescription(sourceDoc);
    renderedStarts.push(
      `- [${title}](${relativeDocLink(sourceDoc.relativePath, docsSubdir)}): ${description}`
    );
  }
  if (renderedStarts.length > 0) {
    lines.push("", "## Best Starting Points", "", ...renderedStarts);
  }

  for (const group of resolved) {
    const pages = pagesUnderGroup(group, membership);
    if (pages.length === 0) {
      continue;
    }
    lines.push("", `## ${group.title}`);
    if (group.description) {
      lines.push("", group.description);
    }
    lines.push("");
    for (const page of pages) {
      lines.push(
        `- [${page.title}](${relativeDocLink(page.relativePath, docsSubdir)}): ${pageDescription(page)}`
      );
    }
  }

  if (membership.ungrouped.length > 0) {
    lines.push("", "## Other", "");
    for (const page of membership.ungrouped) {
      lines.push(
        `- [${page.title}](${relativeDocLink(page.relativePath, docsSubdir)}): ${pageDescription(page)}`
      );
    }
  }

  // Skip product.agentGuidance — it's written for the website's llms.txt
  // routing flow ("open /docs/llms.txt then…") and would mislead an agent
  // reading from node_modules. The preamble paragraph already covers offline
  // navigation in format-agnostic terms.

  const content = `${lines.join("\n")}\n`;
  await mkdir(outDir, { recursive: true });
  const outputPath = path.join(outDir, "AGENTS.md");
  await writeFile(outputPath, content);
  return { outputPath };
}

/* ---------------- Navigation manifest ----------------------------------- */

function pageView(doc: SourceDoc): DocsNavigationPage {
  return {
    urlPath: doc.urlPath,
    title: doc.title,
    description: doc.description,
    groups: [...doc.groups],
  };
}

function buildNavigationGroup(
  group: ResolvedGroup,
  membership: GroupMembership
): DocsNavigationGroup {
  const directPages = membership.byGroupSlug.get(group.slugKey) ?? [];
  return {
    slug: group.slug,
    segmentPath: group.segmentPath,
    title: group.title,
    description: group.description,
    pages: directPages.map(pageView),
    children: group.children.map((child) =>
      buildNavigationGroup(child, membership)
    ),
  };
}

/**
 * Walk the docs source tree once and return a structured navigation manifest.
 * Build pipelines write this to disk (e.g. `src/generated/docs-nav.json`)
 * for the runtime sidebar to import — keeps the docs-config.ts as the single
 * source of truth without forcing the runtime to scan MDX itself.
 */
export async function resolveDocsNavigation(
  config: ResolveDocsNavigationConfig
): Promise<DocsNavigation> {
  const srcDir = path.resolve(config.srcDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const sourceDocs = await readSourceDocs(srcDir, baseUrl);
  const resolved = resolveGroups(config.groups);
  const membership = buildGroupMembership([...sourceDocs.values()], resolved);

  return {
    groups: resolved.map((group) => buildNavigationGroup(group, membership)),
    ungrouped: membership.ungrouped.map(pageView),
    unknown: membership.unknown.map(({ page, slug }) => ({
      urlPath: page.urlPath,
      slug,
    })),
  };
}
