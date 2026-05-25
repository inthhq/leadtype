import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LLMS_VARIANT_VALUES = [
  "page-links",
  "explicit-bundles",
  "monolith",
  "router",
  "section-indexes",
] as const;

export type LlmsVariant = (typeof LLMS_VARIANT_VALUES)[number];

export const LLMS_VARIANTS: readonly string[] = LLMS_VARIANT_VALUES;

type DocsGroup = {
  slug: string;
  title: string;
  description: string;
};

type DocsPage = {
  path: string;
  title: string;
  description: string;
  group: LlmsVariantGroup;
  content: string;
};

type LlmsVariantGroup =
  | "get-started"
  | "authoring"
  | "build"
  | "package-docs"
  | "reference";

const GROUPS: Record<LlmsVariantGroup, DocsGroup> = {
  "get-started": {
    slug: "get-started",
    title: "Get Started",
    description:
      "What Leadtype is, how it fits together, and the five-minute happy path.",
  },
  authoring: {
    slug: "authoring",
    title: "Authoring",
    description:
      "Frontmatter, groups, and MDX components that flatten into markdown.",
  },
  build: {
    slug: "build",
    title: "Build",
    description: "Docs-site wiring and agent-readable deployment artifacts.",
  },
  "package-docs": {
    slug: "package-docs",
    title: "Ship Package Docs",
    description:
      "Bundle AGENTS.md and version-matched markdown inside an npm tarball.",
  },
  reference: {
    slug: "reference",
    title: "Reference",
    description:
      "CLI flags, conversion APIs, LLM bundle APIs, search, and lint reference.",
  },
};

const PAGES: DocsPage[] = [
  {
    path: "docs/quickstart.md",
    title: "Quickstart",
    description:
      "Install Leadtype, run the generator, and inspect the generated artifacts.",
    group: "get-started",
    content: `# Quickstart

Install Leadtype in a docs project, author MDX under docs/, and run leadtype generate.

Website mode writes /llms.txt, /docs/llms.txt, /llms-full.txt, markdown mirrors under /docs/*.md, docs/sitemap.xml, docs/sitemap.md, docs/robots.txt, docs/agent-readability.json, docs/search-index.json, and docs/search-content.json.

Bundle mode is different. leadtype generate --bundle writes AGENTS.md and docs/*.md for npm packages, with relative links that work inside node_modules.`,
  },
  {
    path: "docs/how-it-works.md",
    title: "How it works",
    description:
      "The pipeline model for one MDX source serving humans, agents, and search.",
    group: "get-started",
    content: `# How it works

Leadtype starts with MDX pages, reads frontmatter, flattens supported MDX components into markdown, resolves the group tree, and emits website or package artifacts.

HTTP agents start at /llms.txt and follow markdown links. Coding agents working inside installed npm packages start at AGENTS.md and follow relative docs/*.md links.

The two flows complement each other. A package can publish bundled offline docs for node_modules and a hosted docs website with llms.txt for URL-based agents.`,
  },
  {
    path: "docs/authoring/frontmatter.md",
    title: "Frontmatter",
    description:
      "Required fields, group semantics, optional fields, and lint behavior.",
    group: "authoring",
    content: `# Frontmatter

Each MDX page has YAML frontmatter. title is required. description is optional but recommended because it becomes the routing hint in llms.txt. group is optional and should match a slug from docs.config.ts.

The group value drives the sidebar position, the llms.txt section, search metadata, and AGENTS.md grouping. Pages can belong to multiple groups with group: [a, b]. The root /llms-full.txt fallback contains all generated markdown pages and is not split by group. If a page declares an unknown group, the build fails.

Optional fields include icon, status, deprecated, tags, variants, related, full, lastModified, and lastAuthor. status is editorial page metadata: new, updated, or experimental. lastModified and lastAuthor are filled in when --enrich-git is enabled.`,
  },
  {
    path: "docs/authoring/components.md",
    title: "Components",
    description:
      "MDX component names that the remark pipeline converts into markdown.",
    group: "authoring",
    content: `# Components

Leadtype does not ship UI components. The docs app owns runtime rendering while Leadtype owns conversion to agent-readable markdown.

The default component contract includes Callout, Cards, CommandTabs, Details, Mermaid, Steps, Tabs, TopicSwitcher, TypeTable, ExtractedTypeTable, Accordion, and Example.

Flattening converts interactive MDX into portable markdown. Tabs become a heading per tab, Callout becomes a blockquote, TypeTable becomes a markdown table, and Mermaid preserves the diagram source in a fenced block.`,
  },
  {
    path: "docs/build/connect-docs-site.md",
    title: "Connect a docs site",
    description:
      "Wire Leadtype into a hosted docs build so agents can fetch markdown.",
    group: "build",
    content: `# Connect a docs site

Use website mode when a docs site should expose HTTP-discoverable agent files. The build should generate /llms.txt at the site root and markdown mirrors under /docs/*.md.

For agent requests, serve markdown when Accept asks for text/markdown or when a known AI user agent requests a docs page. Keep /llms.txt, /llms-full.txt, sitemap files, robots.txt, search JSON, and agent-readability.json as static artifacts.

Good verification checks include fetching /llms.txt, fetching a docs page with Accept: text/markdown, checking /docs/sitemap.xml, and confirming /robots.txt allows /llms.txt.`,
  },
  {
    path: "docs/package-docs/bundle.md",
    title: "Bundle docs into a package",
    description:
      "Ship AGENTS.md and markdown docs inside an npm tarball for offline agents.",
    group: "package-docs",
    content: `# Bundle docs into a package

Use leadtype generate --bundle when publishing an npm package. Bundle mode writes AGENTS.md at the package root and docs/*.md beneath it.

AGENTS.md uses relative links like ./docs/reference/cli.md so coding agents can read docs inside node_modules without a network request.

Bundle mode skips website-only artifacts: llms.txt, llms-full.txt, search JSON, sitemap files, robots.txt, and agent-readability.json.`,
  },
  {
    path: "docs/reference/cli.md",
    title: "CLI",
    description:
      "leadtype generate and leadtype lint flags, exit codes, and JSON output.",
    group: "reference",
    content: `# CLI

leadtype generate converts docs and writes agent-readable artifacts. Important flags include --src, --out, --base-url, --bundle, --json, --enrich-git, and --strict.

When --json is enabled, generate prints a JSON object with paths for the generated artifacts. The website-mode object includes llmsFullTxt, docsLlmsTxt, llmsTxt, agentReadabilityJson, sitemapXml, sitemapMd, robotsTxt, searchIndex, and searchContent.

leadtype lint validates frontmatter, group references, links, and schema rules. Use --format github in CI and --error-unknown with --max-warnings 0 when unknown frontmatter fields should fail the build.`,
  },
  {
    path: "docs/reference/llm.md",
    title: "LLM files",
    description:
      "Generate llms.txt, the root full-context fallback, and AGENTS.md.",
    group: "reference",
    content: `# LLM files

generateLlmsTxt writes the product-level /llms.txt and the docs-scoped /docs/llms.txt map for hosted websites.

generateLLMFullContextFiles writes one root /llms-full.txt file containing every generated markdown docs page. Groups still organize llms.txt sections, navigation, search metadata, and AGENTS.md; they are not published as per-group full-context files by default.

generateAgentsMd writes AGENTS.md for npm-bundled docs. It intentionally ignores product.agentGuidance because that text is written for website URL routing.

isAgentReadabilityArtifactPath identifies artifact paths that should not be rewritten as missing markdown pages. It covers llms.txt, llms-full.txt, sitemap files, robots.txt, search JSON, and agent-readability.json.

Use groups for routing, not sharding. Group descriptions should be routing hints, not marketing copy.`,
  },
  {
    path: "docs/reference/search.md",
    title: "Search",
    description:
      "Static search index, source-grounded answers, and when embeddings help.",
    group: "reference",
    content: `# Search

Leadtype builds a static local search index over generated markdown at build time. The runtime query path is edge-safe and does not require a database.

The default search path uses lexical BM25-style ranking over titles, headings, body text, and code. Search output can feed source-grounded answer generation.

Leadtype does not include a hosted database-backed vector index by default. Add embeddings only when docs vocabulary does not match user vocabulary or the corpus grows large enough to need semantic retrieval.`,
  },
];

export function parseLlmsVariant(value: string | undefined): LlmsVariant {
  if (isLlmsVariant(value)) {
    return value;
  }
  throw new Error(
    `--variant must be one of ${LLMS_VARIANTS.join("|")}, got ${value}`
  );
}

export function isLlmsVariant(value: unknown): value is LlmsVariant {
  return typeof value === "string" && LLMS_VARIANTS.includes(value);
}

export async function materializeLlmsVariant(options: {
  tempDir: string;
  variant: LlmsVariant;
}): Promise<void> {
  const { tempDir, variant } = options;
  await writeDocsPages(tempDir);

  await writeTextFile(tempDir, "llms.txt", renderLlmsTxt(variant));

  switch (variant) {
    case "page-links":
      return;
    case "explicit-bundles":
      await writeTopicBundles(tempDir);
      return;
    case "monolith":
      await writeTextFile(tempDir, "llms-full.txt", renderMonolith());
      return;
    case "router":
      await writeTopicBundles(tempDir);
      await writeTextFile(tempDir, "llms-full.txt", renderRootRouter());
      return;
    case "section-indexes":
      await writeTopicBundles(tempDir);
      await writeSectionIndexes(tempDir);
      return;
    default: {
      const _exhaustive: never = variant;
      throw new Error(`Unhandled llms variant: ${String(_exhaustive)}`);
    }
  }
}

function pagesForGroup(group: LlmsVariantGroup): DocsPage[] {
  return PAGES.filter((page) => page.group === group);
}

function pageUrl(page: DocsPage): string {
  return `/${page.path}`;
}

function renderLink(title: string, href: string, description: string): string {
  return `- [${title}](${href}): ${description}`;
}

function renderLlmsTxt(variant: LlmsVariant): string {
  const lines = [
    "# Leadtype",
    "",
    "> A docs pipeline that turns one MDX source into a website, agent-readable bundles, and a search index.",
    "",
  ];

  switch (variant) {
    case "page-links":
      lines.push(
        "## How To Use",
        "",
        "Use the page-level markdown links below. Read the smallest page or pages that answer the task.",
        "",
        ...renderPageSections()
      );
      return lines.join("\n");
    case "explicit-bundles":
      lines.push(
        "## How To Use",
        "",
        "Choose the smallest full-context bundle that matches the task.",
        "",
        "## Full Context Bundles",
        "",
        ...renderBundleLinks()
      );
      return lines.join("\n");
    case "monolith":
      lines.push(
        "## How To Use",
        "",
        "Read the single all-docs full-context file when task-specific context is needed.",
        "",
        renderLink(
          "All Docs Full Context",
          "/llms-full.txt",
          "Every generated markdown docs page flattened into one file."
        )
      );
      return lines.join("\n");
    case "section-indexes":
      lines.push(
        "## How To Use",
        "",
        "Choose the smallest section index that matches the task, then read the linked page markdown. Use a section full-context bundle only when page links are not enough.",
        "",
        "## Section Indexes",
        "",
        ...renderSectionIndexLinks()
      );
      return lines.join("\n");
    case "router":
      lines.push(
        "## How To Use",
        "",
        "Read the full-context router, then choose the smallest topic file that matches the task.",
        "",
        renderLink(
          "Full Context Router",
          "/llms-full.txt",
          "Routes to topic-specific deep-context files."
        )
      );
      return lines.join("\n");
    default: {
      const _exhaustive: never = variant;
      throw new Error(`Unhandled llms variant: ${String(_exhaustive)}`);
    }
  }
}

function renderSectionIndexLinks(): string[] {
  return Object.values(GROUPS).map((group) =>
    renderLink(group.title, `/docs/${group.slug}/llms.txt`, group.description)
  );
}

function renderPageSections(): string[] {
  const lines: string[] = [];
  for (const group of Object.values(GROUPS)) {
    lines.push(`## ${group.title}`, "", group.description, "");
    for (const page of pagesForGroup(group.slug as LlmsVariantGroup)) {
      lines.push(renderLink(page.title, pageUrl(page), page.description));
    }
    lines.push("");
  }
  return trimTrailingBlank(lines);
}

function renderBundleLinks(): string[] {
  return Object.values(GROUPS).map((group) =>
    renderLink(
      group.title,
      `/docs/llms-full/${group.slug}.txt`,
      group.description
    )
  );
}

function renderRootRouter(): string {
  return [
    "# Leadtype Full Context Router",
    "",
    "> Choose the smallest topic file that matches the task.",
    "",
    "## Topics",
    "",
    ...renderBundleLinks(),
  ].join("\n");
}

function renderMonolith(): string {
  return [
    "# Leadtype Full Context",
    "",
    "> All generated markdown docs pages flattened into one file.",
    "",
    ...PAGES.map(renderPageContentBlock),
  ].join("\n\n");
}

async function writeDocsPages(tempDir: string): Promise<void> {
  for (const page of PAGES) {
    await writeTextFile(tempDir, page.path, renderPageContentBlock(page));
  }
}

async function writeTopicBundles(tempDir: string): Promise<void> {
  for (const group of Object.values(GROUPS)) {
    const pages = pagesForGroup(group.slug as LlmsVariantGroup);
    await writeTextFile(
      tempDir,
      `docs/llms-full/${group.slug}.txt`,
      renderTopicBundle(group, pages)
    );
  }
}

async function writeSectionIndexes(tempDir: string): Promise<void> {
  for (const group of Object.values(GROUPS)) {
    const pages = pagesForGroup(group.slug as LlmsVariantGroup);
    await writeTextFile(
      tempDir,
      `docs/${group.slug}/llms.txt`,
      renderSectionIndex(group, pages)
    );
  }
}

function renderSectionIndex(group: DocsGroup, pages: DocsPage[]): string {
  return [
    `# Leadtype ${group.title}`,
    "",
    `> ${group.description}`,
    "",
    "Read the page-level markdown links first. If the answer needs broader section context, use the optional full-context bundle.",
    "",
    "## Pages",
    "",
    ...pages.map((page) =>
      renderLink(page.title, pageUrl(page), page.description)
    ),
    "",
    "## Optional",
    "",
    renderLink(
      `${group.title} Full Context`,
      `/docs/llms-full/${group.slug}.txt`,
      `All ${group.title} pages flattened into one section bundle.`
    ),
  ].join("\n");
}

function renderTopicBundle(group: DocsGroup, pages: DocsPage[]): string {
  return [
    `# Leadtype ${group.title} Full Context`,
    "",
    `> ${group.description}`,
    "",
    "## Included Pages",
    "",
    ...pages.map((page) =>
      renderLink(page.title, pageUrl(page), page.description)
    ),
    "",
    "## Content",
    "",
    ...pages.map(renderPageContentBlock),
  ].join("\n");
}

function renderPageContentBlock(page: DocsPage): string {
  return [`# ${page.title}`, `URL: ${pageUrl(page)}`, "", page.content].join(
    "\n"
  );
}

async function writeTextFile(
  tempDir: string,
  relativePath: string,
  content: string
): Promise<void> {
  const target = path.join(tempDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${content.trim()}\n`, "utf-8");
}

function trimTrailingBlank(lines: string[]): string[] {
  const result = [...lines];
  while (result.at(-1) === "") {
    result.pop();
  }
  return result;
}
