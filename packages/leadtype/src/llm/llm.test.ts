import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentArtifactHandler } from "../internal/framework";
import {
  type DocsNavEntry,
  defineFrameworkNavigation,
  extractDocsTableOfContents,
  generateAgentReadabilityArtifacts,
  generateAgentsMd,
  generateLLMFullContextFiles,
  generateLlmsTxt,
  resolveDocsNavigation,
  resolveDocsTableOfContents,
} from "./llm";
import {
  acceptsMarkdownHeader,
  createAgentDiscoveryHeaders,
  createAgentDiscoveryLinkHeader,
  createAgentMarkdownResponse,
  createApiCatalogResponse,
  createDocsHead,
  createDocsJsonLd,
  createMarkdownResponseHeaders,
  createRobotsTxtResponse,
  createSitemapMarkdownResponse,
  createSitemapXmlResponse,
  enrichMarkdownFrontmatter,
  isAgentReadabilityArtifactPath,
  isAgentUserAgent,
  type MarkdownMirrorTarget,
  type MarkdownReadErrorTarget,
  renderApiCatalog,
  renderJsonLd,
  renderJsonLdScript,
  renderMissingMarkdown,
  renderRobotsTxt,
  renderSiteJsonLd,
  renderSitemapXml,
  resolveManifestMarkdownMirrorTarget,
  resolveMarkdownMirrorTarget,
  stringifyJsonLd,
  validateJsonLd,
} from "./readability";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-llm-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

type SeedFile = {
  /** Relative path under `<project>/docs/`, e.g. "frameworks/react/quickstart.md" */
  relativePath: string;
  frontmatter: string;
  body?: string;
};

async function seedDocs(projectDir: string, files: SeedFile[]): Promise<void> {
  const docsDir = path.join(projectDir, "docs");
  await Promise.all(
    files.map(async (file) => {
      const fullPath = path.join(docsDir, file.relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(
        fullPath,
        `---\n${file.frontmatter}\n---\n${file.body ?? ""}`
      );
    })
  );
}

describe("generateLlmsTxt", () => {
  it("lets transformers customize llms.txt artifacts before write", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start here.",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      product: { name: "Test", summary: "Testing." },
      groups: [{ slug: "guides", title: "Guides" }],
      transformers: [
        {
          name: "append-note",
          beforeLlmsTxt(artifact) {
            if (artifact.kind !== "root") {
              return;
            }
            return {
              ...artifact,
              content: `${artifact.content}\nTransformer note.\n`,
            };
          },
        },
      ],
    });

    await expect(
      readFile(path.join(outDir, "llms.txt"), "utf8")
    ).resolves.toContain("Transformer note.");
  });

  it("appends an Agent Interfaces section when endpoints are configured", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start here.",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Test", summary: "Testing." },
      groups: [{ slug: "guides", title: "Guides" }],
      agentInterfaces: {
        mcpEndpoint: "https://leadtype.dev/mcp",
        mcpServerCardUrl:
          "https://leadtype.dev/.well-known/mcp/server-card.json",
        askEndpoint: "https://leadtype.dev/ask",
      },
    });

    const llms = await readFile(path.join(outDir, "llms.txt"), "utf8");
    expect(llms).toContain("## Agent Interfaces");
    expect(llms).toContain(
      "MCP server (Streamable HTTP): https://leadtype.dev/mcp"
    );
    expect(llms).toContain(
      "server card: https://leadtype.dev/.well-known/mcp/server-card.json"
    );
    expect(llms).toContain("NLWeb /ask endpoint: https://leadtype.dev/ask");
    // The well-known discovery copy carries the same section.
    await expect(
      readFile(path.join(outDir, ".well-known", "llms.txt"), "utf8")
    ).resolves.toContain("## Agent Interfaces");
  });

  it("publishes a discovery copy at /.well-known/llms.txt", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start here.",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      product: { name: "Test", summary: "Testing." },
      groups: [{ slug: "guides", title: "Guides" }],
    });

    const [root, wellKnown] = await Promise.all([
      readFile(path.join(outDir, "llms.txt"), "utf8"),
      readFile(path.join(outDir, ".well-known", "llms.txt"), "utf8"),
    ]);
    expect(wellKnown).toBe(root);
  });

  it("renders nested curated nav sections when nav is configured", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "ai-agents.mdx",
        frontmatter: "title: AI Agents\ndescription: Agent setup.",
      },
      {
        relativePath: "frameworks/next/quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start here.",
      },
      {
        relativePath: "frameworks/next/concepts/client-modes.mdx",
        frontmatter:
          "title: Client Modes\ndescription: Client modes.\norder: 20",
      },
      {
        relativePath: "frameworks/next/concepts/initialization-flow.mdx",
        frontmatter:
          "title: Initialization Flow\ndescription: Initialization.\norder: 10",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t", summary: "Consent platform." },
      nav: [
        {
          title: "Frameworks",
          children: [
            {
              title: "Next.js",
              base: "frameworks/next",
              children: [
                {
                  title: "Start",
                  pages: ["quickstart", "/ai-agents"],
                },
                {
                  title: "Concepts",
                  pages: [
                    "concepts/client-modes",
                    { include: "concepts/*", sort: ["order", "path"] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    expect(docsSummary).toContain("## Frameworks");
    expect(docsSummary).toContain("### Next.js");
    expect(docsSummary).toContain("#### Start");
    expect(docsSummary).toContain("#### Concepts");
    expect(docsSummary).toContain("](/docs/frameworks/next/quickstart.md)");
    expect(docsSummary).toContain("](/docs/ai-agents.md)");
    expect(docsSummary.indexOf("Client Modes")).toBeLessThan(
      docsSummary.indexOf("Initialization Flow")
    );
    expect(docsSummary.match(/Client Modes/g)).toHaveLength(1);
  });

  it("collapses optional nav sections into a single ## Optional section", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start here.",
      },
      {
        relativePath: "legacy/v1.mdx",
        frontmatter: "title: Legacy v1\ndescription: Old API.",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://example.com",
      product: { name: "Test", summary: "Testing." },
      nav: [
        { title: "Start", pages: ["quickstart"] },
        { title: "Legacy", base: "legacy", optional: true, pages: ["v1"] },
      ],
    });

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    expect(docsSummary).toContain("## Optional");
    // The optional section's own heading is not rendered as a normal section…
    expect(docsSummary).not.toContain("## Legacy");
    // …and its page is listed under ## Optional, after the required sections.
    expect(docsSummary).toContain("](/docs/legacy/v1.md)");
    expect(docsSummary.indexOf("## Start")).toBeLessThan(
      docsSummary.indexOf("## Optional")
    );
    expect(docsSummary.indexOf("## Optional")).toBeLessThan(
      docsSummary.indexOf("/docs/legacy/v1.md")
    );
  });

  it("renders curated docs sections from the group tree and frontmatter", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "frameworks/react/quickstart.mdx",
        frontmatter:
          "title: React Quickstart\ndescription: Get started with React.\ngroup: react",
      },
      {
        relativePath: "frameworks/next/quickstart.mdx",
        frontmatter:
          "title: Next.js Quickstart\ndescription: Get started with Next.js.\ngroup: next",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: {
        name: "c15t",
        summary: "Consent platform.",
        bestStartingPoints: [{ urlPath: "/docs/frameworks/react/quickstart" }],
      },
      groups: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Framework integrations.",
          children: [
            {
              slug: "react",
              title: "React",
              description: "React integration.",
            },
            {
              slug: "next",
              title: "Next.js",
              description: "Next.js integration.",
            },
          ],
        },
      ],
    });

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    const rootSummary = await readFile(path.join(outDir, "llms.txt"), "utf8");
    expect(rootSummary).toContain("](/docs/frameworks/react/quickstart.md)");
    expect(rootSummary).not.toContain(
      "https://c15t.com/docs/frameworks/react/quickstart"
    );
    expect(docsSummary).toContain("## Frameworks");
    expect(docsSummary).toContain("React Quickstart");
    expect(docsSummary).toContain("Next.js Quickstart");
    expect(docsSummary).toContain("](/docs/frameworks/react/quickstart.md)");
    expect(docsSummary).not.toContain(
      "https://c15t.com/docs/frameworks/react/quickstart"
    );
  });

  it("renders the product summary even when no groups are declared", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "index.mdx",
        frontmatter: "title: Home\ndescription: Welcome.",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: {
        name: "c15t",
        summary: "Consent platform.",
        bestStartingPoints: [{ urlPath: "/docs" }],
      },
      groups: [],
    });

    const rootSummary = await readFile(path.join(outDir, "llms.txt"), "utf8");
    expect(rootSummary).toContain("# c15t");
    expect(rootSummary).toContain("> Consent platform.");
    expect(rootSummary).toContain("](/docs/index.md)");
  });

  it("renders shared pages under every group they declare", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "rate-limiting.mdx",
        frontmatter:
          "title: Rate Limiting\ndescription: Shared rate-limit reference.\ngroup:\n  - search\n  - self-host",
      },
      {
        relativePath: "search-only.mdx",
        frontmatter:
          "title: Search Only\ndescription: Search-only page.\ngroup: search",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t", summary: "Consent platform." },
      groups: [
        { slug: "search", title: "Search", description: "Search APIs." },
        {
          slug: "self-host",
          title: "Self-host",
          description: "Self-host docs.",
        },
      ],
    });

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    const searchSection = docsSummary.split("## Search")[1] ?? "";
    const selfHostSection = docsSummary.split("## Self-host")[1] ?? "";
    expect(searchSection).toContain("Rate Limiting");
    expect(selfHostSection).toContain("Rate Limiting");
    expect(searchSection).toContain("Search Only");
    expect(selfHostSection).not.toContain("Search Only");
  });

  it("renders locale-scoped llms summaries without fallback pages", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter:
          "title: Quickstart\ndescription: English quickstart.\ngroup: get-started",
      },
      {
        relativePath: "setup.mdx",
        frontmatter:
          "title: Setup\ndescription: English setup.\ngroup: get-started",
      },
      {
        relativePath: "zh/quickstart.mdx",
        frontmatter:
          "title: 快速开始\ndescription: 中文快速开始。\ngroup: get-started",
      },
    ]);

    const llmsTxtRelativePaths: string[] = [];
    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      groups: [{ slug: "get-started", title: "Get Started" }],
      i18n: { defaultLocale: "en", locales: ["en", "zh"] },
      locale: "zh",
      transformers: [
        {
          name: "capture-paths",
          beforeLlmsTxt(_artifact, context) {
            if (context.relativePath) {
              llmsTxtRelativePaths.push(context.relativePath);
            }
          },
        },
      ],
    });

    const zhSummary = await readFile(
      path.join(outDir, "docs", "zh", "llms.txt"),
      "utf8"
    );
    expect(zhSummary).toContain("快速开始");
    expect(zhSummary).toContain("](/docs/zh/quickstart.md)");
    expect(zhSummary).not.toContain("Setup");
    expect(llmsTxtRelativePaths).toContain("docs/zh/llms.txt");
  });

  it("rejects duplicate localized source files for the same locale and logical path", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.md",
        frontmatter: "title: Quickstart",
      },
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart duplicate",
      },
    ]);

    await expect(
      generateLlmsTxt({
        srcDir: projectDir,
        outDir,
        baseUrl: "https://leadtype.dev",
        product: { name: "Leadtype" },
        i18n: { defaultLocale: "en", locales: ["en", "zh"] },
        locale: "en",
      })
    ).rejects.toThrow(/Duplicate docs file.*locale "en"/);
  });

  it("synthesizes legacy product fields into the default block sequence", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start here.",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: {
        name: "c15t",
        summary: "Consent platform.",
        bullets: ["Add consent banners."],
        bestStartingPoints: [{ urlPath: "/docs/quickstart" }],
        agentGuidance: "Start with the quickstart.",
      },
      groups: [],
    });

    const rootSummary = await readFile(path.join(outDir, "llms.txt"), "utf8");
    expect(rootSummary).toContain("## Product Summary");
    expect(rootSummary).toContain("- Add consent banners.");
    // Order is preserved: summary → starting points → agent guidance.
    expect(rootSummary.indexOf("## Product Summary")).toBeLessThan(
      rootSummary.indexOf("## Best Starting Points")
    );
    expect(rootSummary.indexOf("## Best Starting Points")).toBeLessThan(
      rootSummary.indexOf("## Agent Guidance")
    );
  });

  it("renders ordered content blocks with custom headings", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start here.",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: {
        name: "c15t",
        summary: "Consent platform.",
        blocks: [
          {
            type: "markdown",
            heading: "Overview",
            body: "- Consent done right.",
          },
          {
            type: "markdown",
            heading: "Popularity",
            body: "2.3k stars. Hosted by [Inth](https://inth.com).",
          },
          {
            type: "links",
            heading: "Best Starting Points",
            links: [{ urlPath: "/docs/quickstart" }],
          },
        ],
      },
      groups: [],
    });

    const rootSummary = await readFile(path.join(outDir, "llms.txt"), "utf8");
    expect(rootSummary).toContain("## Overview");
    expect(rootSummary).not.toContain("## Product Summary");
    expect(rootSummary).toContain("Hosted by [Inth](https://inth.com).");
    // A links block resolves the page title and a markdown URL path.
    expect(rootSummary).toContain("Quickstart");
    expect(rootSummary).toContain("](/docs/quickstart.md)");
    // Block array order is preserved in the output.
    expect(rootSummary.indexOf("## Popularity")).toBeLessThan(
      rootSummary.indexOf("## Best Starting Points")
    );
  });
});

describe("generateAgentsMd", () => {
  it("renders author-curated blocks in the offline bundle", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter:
          "title: Quickstart\ndescription: Start here.\ngroup: guides",
      },
    ]);

    await generateAgentsMd({
      srcDir: projectDir,
      outDir,
      product: {
        name: "c15t",
        summary: "Consent platform.",
        blocks: [
          {
            type: "markdown",
            heading: "Overview",
            body: "- Consent done right.",
          },
          {
            type: "links",
            heading: "Best Starting Points",
            links: [{ urlPath: "/docs/quickstart" }],
          },
        ],
      },
      groups: [{ slug: "guides", title: "Guides" }],
    });

    const agents = await readFile(path.join(outDir, "AGENTS.md"), "utf8");
    expect(agents).toContain("## Overview");
    expect(agents).toContain("- Consent done right.");
    // Link blocks use relative filesystem paths inside the bundle.
    expect(agents).toContain("](./docs/quickstart.md)");
  });
});

describe("generateLLMFullContextFiles", () => {
  it("emits one root full-context file with all generated docs", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "frameworks/react/quickstart.md",
        frontmatter:
          "title: React Quickstart\ndescription: React.\ngroup: react",
        body: "# React Quickstart\n\nBody.\n",
      },
      {
        relativePath: "frameworks/next/quickstart.md",
        frontmatter:
          "title: Next.js Quickstart\ndescription: Next.js.\ngroup: next",
        body: "# Next.js Quickstart\n\nBody.\n",
      },
    ]);

    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      groups: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Framework integrations.",
          children: [
            {
              slug: "react",
              title: "React",
              description: "React integration.",
            },
            {
              slug: "next",
              title: "Next.js",
              description: "Next.js integration.",
            },
          ],
        },
      ],
    });

    const llmsFull = await readFile(
      path.join(projectDir, "llms-full.txt"),
      "utf8"
    );
    expect(llmsFull).toContain("# c15t Full Context");
    expect(llmsFull).toContain("React Quickstart");
    expect(llmsFull).toContain("Next.js Quickstart");
    expect(llmsFull).toContain(
      "https://c15t.com/docs/frameworks/react/quickstart"
    );
    expect(llmsFull).toContain(
      "https://c15t.com/docs/frameworks/next/quickstart"
    );
    expect(existsSync(path.join(projectDir, "docs", "llms-full.txt"))).toBe(
      false
    );
    expect(existsSync(path.join(projectDir, "docs", "llms-full"))).toBe(false);
    // Discovery copy at the well-known location, identical to the root file.
    const wellKnownFull = await readFile(
      path.join(projectDir, ".well-known", "llms-full.txt"),
      "utf8"
    );
    expect(wellKnownFull).toBe(llmsFull);
  });

  it("orders content by group in legacy groups mode, matching the manifest", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "client-modes.md",
        frontmatter:
          "title: Client Modes\ndescription: Modes.\ngroup: concepts\norder: 20",
        body: "# Client Modes\n\nBody.\n",
      },
      {
        relativePath: "initialization-flow.md",
        frontmatter:
          "title: Initialization Flow\ndescription: Flow.\ngroup: concepts\norder: 10",
        body: "# Initialization Flow\n\nBody.\n",
      },
      {
        relativePath: "about.md",
        frontmatter: "title: About\ndescription: Ungrouped.",
        body: "# About\n\nBody.\n",
      },
    ]);

    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      groups: [{ slug: "concepts", title: "Concepts" }],
    });

    const llmsFull = await readFile(
      path.join(projectDir, "llms-full.txt"),
      "utf8"
    );
    // Group pages honor `order:` and lead; ungrouped pages trail.
    const positions = [
      llmsFull.indexOf("# Initialization Flow"),
      llmsFull.indexOf("# Client Modes"),
      llmsFull.indexOf("# About"),
    ];
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("inlines a multi-group page only once", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "rate-limiting.md",
        frontmatter:
          "title: Rate Limiting\ndescription: Shared rate-limit reference.\ngroup:\n  - search\n  - self-host",
        body: "# Rate Limiting\n\nShared body.\n",
      },
    ]);

    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      groups: [
        { slug: "search", title: "Search", description: "Search APIs." },
        {
          slug: "self-host",
          title: "Self-host",
          description: "Self-host docs.",
        },
      ],
    });

    const llmsFull = await readFile(
      path.join(projectDir, "llms-full.txt"),
      "utf8"
    );
    expect(llmsFull.match(/^# Rate Limiting$/gm)).toHaveLength(1);
    expect(llmsFull).toContain("Shared body.");
  });

  it("writes non-default locale full-context files under the locale docs path", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.md",
        frontmatter:
          "title: Quickstart\ndescription: English quickstart.\ngroup: get-started",
        body: "# Quickstart\n\nEnglish body.\n",
      },
      {
        relativePath: "setup.md",
        frontmatter:
          "title: Setup\ndescription: English setup.\ngroup: get-started",
        body: "# Setup\n\nEnglish setup.\n",
      },
      {
        relativePath: "zh/quickstart.md",
        frontmatter:
          "title: 快速开始\ndescription: 中文快速开始。\ngroup: get-started",
        body: "# 快速开始\n\n中文正文。\n",
      },
    ]);

    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype" },
      groups: [{ slug: "get-started", title: "Get Started" }],
      i18n: { defaultLocale: "en", locales: ["en", "zh"] },
      locale: "zh",
    });

    const llmsFull = await readFile(
      path.join(projectDir, "docs", "zh", "llms-full.txt"),
      "utf8"
    );
    expect(llmsFull).toContain("快速开始");
    expect(llmsFull).toContain("https://leadtype.dev/docs/zh/quickstart");
    expect(llmsFull).not.toContain("English setup");
  });

  it("clears stale docs-scoped full-context files", async () => {
    const projectDir = await createTempProject();
    await mkdir(path.join(projectDir, "docs", "llms-full", "frameworks"), {
      recursive: true,
    });
    await writeFile(
      path.join(projectDir, "docs", "llms-full.txt"),
      "stale docs router"
    );
    await writeFile(
      path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt"),
      "stale nested topic"
    );
    await seedDocs(projectDir, [
      {
        relativePath: "frameworks/react/quickstart.md",
        frontmatter:
          "title: React Quickstart\ndescription: React.\ngroup: react",
        body: "# React Quickstart\n",
      },
    ]);

    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      groups: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Frameworks.",
          children: [{ slug: "react", title: "React", description: "React." }],
        },
      ],
    });

    expect(existsSync(path.join(projectDir, "llms-full.txt"))).toBe(true);
    expect(existsSync(path.join(projectDir, "docs", "llms-full.txt"))).toBe(
      false
    );
    expect(
      existsSync(
        path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt")
      )
    ).toBe(false);
  });

  it("rejects duplicate sibling group slugs (case-insensitive)", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "page.md",
        frontmatter: "title: Page\ndescription: Page.\ngroup: react",
        body: "# Page\n",
      },
    ]);

    await expect(
      generateLLMFullContextFiles({
        outDir: projectDir,
        baseUrl: "https://c15t.com",
        product: { name: "c15t" },
        groups: [
          {
            slug: "frameworks",
            title: "Frameworks",
            description: "Frameworks.",
            children: [
              { slug: "React", title: "React", description: "React." },
              { slug: "react", title: "React duplicate", description: "Dup." },
            ],
          },
        ],
      })
    ).rejects.toThrow(/Duplicate group slug "react" under "frameworks"/i);
  });

  it("rejects an invalid group slug shape", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "page.md",
        frontmatter: "title: Page\ndescription: Page.\ngroup: ok",
        body: "# Page\n",
      },
    ]);

    await expect(
      generateLLMFullContextFiles({
        outDir: projectDir,
        baseUrl: "https://c15t.com",
        product: { name: "c15t" },
        groups: [{ slug: "Bad/Slug", title: "Bad", description: "Bad." }],
      })
    ).rejects.toThrow(/Invalid group slug/);
  });
});

describe("generateAgentReadabilityArtifacts", () => {
  it("records storage paths independently from mounted markdown URLs", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "changelog/v1.md",
        frontmatter: "title: Version one\ndescription: Changelog.",
        body: "# Version one\n",
      },
      {
        relativePath: "rest-api/index.md",
        frontmatter: "title: REST API\ndescription: API reference.",
        body: "# REST API\n",
      },
    ]);

    const result = await generateAgentReadabilityArtifacts({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      mounts: [
        { pathPrefix: "changelog", urlPrefix: "/changelog" },
        { pathPrefix: "", urlPrefix: "/docs" },
      ],
    });
    expect(result.manifest.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          markdownUrlPath: "/changelog/v1.md",
          markdownFilePath: "docs/changelog/v1.md",
        }),
        expect.objectContaining({
          markdownUrlPath: "/docs/rest-api.md",
          markdownFilePath: "docs/rest-api/index.md",
        }),
      ])
    );

    const handler = createAgentArtifactHandler({
      manifest: result.manifest,
      publicDir: projectDir,
    });
    for (const [urlPath, heading] of [
      ["/changelog/v1.md", "# Version one"],
      ["/docs/rest-api.md", "# REST API"],
    ] as const) {
      const response = await handler(
        new Request(`https://leadtype.dev${urlPath}`)
      );
      expect(response?.status).toBe(200);
      await expect(response?.text()).resolves.toContain(heading);
    }
  });

  it("emits root sitemap, robots, and docs-scoped manifest files", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.md",
        frontmatter:
          "title: Quickstart\ndescription: Install and run the package.\ngroup: get-started\nlastModified: 2026-05-01T12:00:00.000Z",
        body: "# Quickstart\n\nBody.\n",
      },
      {
        relativePath: "reference/cli.md",
        frontmatter:
          "title: CLI\ndescription: Command reference.\ngroup: reference\nlast_updated: 2026-05-02",
        body: "# CLI\n\nBody.\n",
      },
    ]);

    const result = await generateAgentReadabilityArtifacts({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: {
        name: "Leadtype",
        summary: "Docs pipeline.",
      },
      groups: [
        {
          slug: "get-started",
          title: "Get Started",
          description: "Start here.",
        },
        {
          slug: "reference",
          title: "Reference",
          description: "API and CLI reference.",
        },
      ],
    });

    expect(existsSync(path.join(projectDir, "docs", "sitemap.xml"))).toBe(
      false
    );
    expect(existsSync(path.join(projectDir, "docs", "sitemap.md"))).toBe(false);
    expect(existsSync(path.join(projectDir, "docs", "robots.txt"))).toBe(false);
    expect(existsSync(path.join(projectDir, "sitemap.xml"))).toBe(true);
    expect(existsSync(path.join(projectDir, "sitemap.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "robots.txt"))).toBe(true);
    // No `apis` configured, so no API catalog is generated or advertised.
    expect(
      existsSync(path.join(projectDir, ".well-known", "api-catalog"))
    ).toBe(false);
    expect(result.files.apiCatalog).toBeUndefined();
    expect(result.manifest.files.apiCatalog).toBeUndefined();
    expect(
      existsSync(path.join(projectDir, "docs", "agent-readability.json"))
    ).toBe(true);

    const sitemapXmlPath = result.files.sitemapXml;
    const sitemapMdPath = result.files.sitemapMd;
    const robotsTxtPath = result.files.robotsTxt;
    expect(sitemapXmlPath).toBe(path.join(projectDir, "sitemap.xml"));
    expect(sitemapMdPath).toBe(path.join(projectDir, "sitemap.md"));
    expect(robotsTxtPath).toBe(path.join(projectDir, "robots.txt"));
    if (!(sitemapXmlPath && sitemapMdPath && robotsTxtPath)) {
      throw new Error("Expected root crawler artifacts to be emitted.");
    }

    const sitemapXml = await readFile(sitemapXmlPath, "utf8");
    expect(sitemapXml).toContain("<urlset");
    expect(sitemapXml).toContain(
      "<loc>https://leadtype.dev/docs/quickstart</loc>"
    );
    expect(sitemapXml).toContain("<lastmod>2026-05-01T12:00:00.000Z</lastmod>");

    const sitemapMd = await readFile(sitemapMdPath, "utf8");
    expect(sitemapMd).toContain("## Get Started");
    expect(sitemapMd).toContain("[Quickstart](/docs/quickstart)");
    expect(sitemapMd).toContain("## Reference");

    const robotsTxt = await readFile(robotsTxtPath, "utf8");
    expect(robotsTxt).toContain("Sitemap: https://leadtype.dev/sitemap.xml");
    expect(robotsTxt).toContain("User-agent: GPTBot");
    expect(robotsTxt).toContain("User-agent: ClaudeBot");
    expect(robotsTxt).toContain("User-agent: Amazonbot");
    expect(robotsTxt).toContain("User-agent: Bytespider");
    expect(robotsTxt).toContain("User-agent: Applebot-Extended");
    expect(robotsTxt).toContain("Allow: /llms.txt");
    expect(robotsTxt).not.toContain("Disallow: /llms.txt");

    expect(result.manifest.pages).toContainEqual(
      expect.objectContaining({
        markdownUrlPath: "/docs/quickstart.md",
        urlPath: "/docs/quickstart",
      })
    );
  });

  it("emits an RFC 9727 catalog listing the configured APIs", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.md",
        frontmatter: "title: Quickstart\ndescription: Install.",
        body: "# Quickstart\n",
      },
    ]);

    const result = await generateAgentReadabilityArtifacts({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      apis: [
        {
          href: "/ask",
          title: "Documentation query API",
          type: "application/json",
          version: "1.0",
          serviceDesc: {
            href: "/openapi.json",
            type: "application/vnd.oai.openapi+json;version=3.1",
          },
          serviceDoc: { href: "/docs/reference/nlweb", type: "text/html" },
          serviceMeta: { href: "/docs/agent-readability.json" },
          status: { href: "https://status.leadtype.dev" },
        },
        { href: "https://api.leadtype.dev/v1/search", title: "Search API" },
      ],
    });

    const apiCatalogPath = result.files.apiCatalog;
    expect(apiCatalogPath).toBe(
      path.join(projectDir, ".well-known", "api-catalog")
    );
    expect(result.manifest.files.apiCatalog).toBe("/.well-known/api-catalog");
    expect(result.manifest.apis).toHaveLength(2);
    if (!apiCatalogPath) {
      throw new Error("Expected an API catalog to be emitted.");
    }

    const catalog = JSON.parse(await readFile(apiCatalogPath, "utf8"));
    expect(catalog.linkset[0]).toEqual({
      anchor: "https://leadtype.dev/.well-known/api-catalog",
      item: [
        {
          href: "https://leadtype.dev/ask",
          type: "application/json",
          title: "Documentation query API",
          version: ["1.0"],
        },
        {
          href: "https://api.leadtype.dev/v1/search",
          title: "Search API",
        },
      ],
    });
    expect(catalog.linkset[1]).toEqual({
      anchor: "https://leadtype.dev/ask",
      "service-desc": [
        {
          href: "https://leadtype.dev/openapi.json",
          type: "application/vnd.oai.openapi+json;version=3.1",
        },
      ],
      "service-doc": [
        {
          href: "https://leadtype.dev/docs/reference/nlweb",
          type: "text/html",
        },
      ],
      "service-meta": [
        { href: "https://leadtype.dev/docs/agent-readability.json" },
      ],
      status: [{ href: "https://status.leadtype.dev/" }],
    });
    // The metadata-free cross-origin API contributes an item, not an anchor.
    expect(catalog.linkset).toHaveLength(2);

    await generateAgentReadabilityArtifacts({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
    });
    expect(existsSync(apiCatalogPath)).toBe(false);
  });

  it("uses Date generatedAt for deterministic docs-scoped manifests", async () => {
    const firstProjectDir = await createTempProject();
    const secondProjectDir = await createTempProject();
    const generatedAt = new Date("2026-06-15T10:30:00.000Z");
    const docs = [
      {
        relativePath: "quickstart.md",
        frontmatter:
          "title: Quickstart\ndescription: Install.\nlastModified: 2026-05-01T12:00:00.000Z",
        body: "# Quickstart\n",
      },
    ];
    await seedDocs(firstProjectDir, docs);
    await seedDocs(secondProjectDir, docs);

    const first = await generateAgentReadabilityArtifacts({
      outDir: firstProjectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      generatedAt,
    });
    const second = await generateAgentReadabilityArtifacts({
      outDir: secondProjectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      generatedAt,
    });

    const firstManifest = await readFile(first.files.manifest, "utf8");
    const secondManifest = await readFile(second.files.manifest, "utf8");
    expect(firstManifest).toBe(secondManifest);
    expect(first.manifest.generatedAt).toBe("2026-06-15T10:30:00.000Z");
  });

  it("pins the lastModified fallback for pages without frontmatter dates", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.md",
        frontmatter: "title: Quickstart\ndescription: Install.",
        body: "# Quickstart\n",
      },
    ]);

    const result = await generateAgentReadabilityArtifacts({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      generatedAt: "2026-06-15T10:30:00.000Z",
    });

    expect(result.manifest.pages[0]?.lastModified).toBe(
      "2026-06-15T10:30:00.000Z"
    );
    if (!result.files.sitemapXml) {
      throw new Error("Expected sitemap.xml to be emitted.");
    }
    expect(await readFile(result.files.sitemapXml, "utf8")).toContain(
      "<lastmod>2026-06-15T10:30:00.000Z</lastmod>"
    );
  });

  it("rejects invalid generatedAt strings", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.md",
        frontmatter: "title: Quickstart\ndescription: Install.",
        body: "# Quickstart\n",
      },
    ]);

    await expect(
      generateAgentReadabilityArtifacts({
        outDir: projectDir,
        baseUrl: "https://leadtype.dev",
        product: { name: "Leadtype", summary: "Docs pipeline." },
        generatedAt: "not-a-date",
      })
    ).rejects.toThrow("generatedAt must be a valid Date or date string");
  });

  it("sorts manifest pages in nav order with non-nav pages appended by urlPath", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "advanced.md",
        frontmatter: "title: Advanced\ndescription: Advanced usage.",
      },
      {
        relativePath: "zulu.md",
        frontmatter: "title: Zulu\ndescription: Listed first in nav.",
      },
      {
        relativePath: "beta.md",
        frontmatter: "title: Beta\ndescription: Not in nav.",
      },
      {
        relativePath: "alpha.md",
        frontmatter: "title: Alpha\ndescription: Not in nav.",
      },
    ]);

    const result = await generateAgentReadabilityArtifacts({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      nav: [{ title: "Guide", pages: ["zulu", "advanced"] }],
    });

    expect(result.manifest.pages.map((page) => page.urlPath)).toEqual([
      "/docs/zulu",
      "/docs/advanced",
      "/docs/alpha",
      "/docs/beta",
    ]);

    // sitemap.xml is rendered from the same list, so it shares the order.
    const sitemapXml = await readFile(result.files.sitemapXml, "utf8");
    const locOrder = ["zulu", "advanced", "alpha", "beta"].map((slug) =>
      sitemapXml.indexOf(`<loc>https://leadtype.dev/docs/${slug}</loc>`)
    );
    expect(locOrder.every((index) => index >= 0)).toBe(true);
    expect([...locOrder].sort((a, b) => a - b)).toEqual(locOrder);
  });

  it("flattens nested nav depth-first, dedupes shared pages, and trails root pages", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "index.md",
        frontmatter: "title: Home\ndescription: Root page.",
      },
      {
        relativePath: "intro.md",
        frontmatter: "title: Intro\ndescription: Intro.",
      },
      {
        relativePath: "shared.md",
        frontmatter: "title: Shared\ndescription: Referenced by two groups.",
      },
      {
        relativePath: "deep.md",
        frontmatter: "title: Deep\ndescription: Nested child page.",
      },
    ]);

    const result = await generateAgentReadabilityArtifacts({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      nav: [
        "index",
        {
          title: "First",
          pages: ["intro", "shared"],
          children: [{ title: "Nested", pages: ["deep"] }],
        },
        { title: "Second", pages: ["shared"] },
      ],
    });

    // Groups flatten depth-first, a page shared across branches appears once
    // at its first position, and root pages trail (they land in `ungrouped`).
    expect(result.manifest.pages.map((page) => page.urlPath)).toEqual([
      "/docs/intro",
      "/docs/shared",
      "/docs/deep",
      "/docs",
    ]);
  });

  it("sorts manifest pages by group order in legacy groups mode", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "client-modes.md",
        frontmatter:
          "title: Client Modes\ndescription: Modes.\ngroup: concepts\norder: 20",
      },
      {
        relativePath: "initialization-flow.md",
        frontmatter:
          "title: Initialization Flow\ndescription: Flow.\ngroup: concepts\norder: 10",
      },
      {
        relativePath: "about.md",
        frontmatter: "title: About\ndescription: Ungrouped.",
      },
    ]);

    const result = await generateAgentReadabilityArtifacts({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      groups: [{ slug: "concepts", title: "Concepts" }],
    });

    expect(result.manifest.pages.map((page) => page.urlPath)).toEqual([
      "/docs/initialization-flow",
      "/docs/client-modes",
      "/docs/about",
    ]);
  });

  it("applies a robotsPolicy + content signals to the emitted robots.txt", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.md",
        frontmatter: "title: Quickstart\ndescription: Install.",
        body: "# Quickstart\n",
      },
    ]);

    const result = await generateAgentReadabilityArtifacts({
      outDir: projectDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      groups: [{ slug: "get-started", title: "Get Started" }],
      robotsPolicy: "block-ai",
      contentSignals: { aiInput: "no" },
    });

    const robotsTxt = await readFile(result.files.robotsTxt, "utf8");
    expect(robotsTxt).toContain(
      "Content-Signal: ai-train=no, search=yes, ai-input=no"
    );
    expect(robotsTxt).toContain("User-agent: GPTBot\nDisallow: /");
    expect(robotsTxt).toContain("User-agent: PerplexityBot\nDisallow: /");
  });

  it("renders helpers that host apps can merge with non-docs pages", () => {
    const pages = [
      {
        title: "Quickstart",
        description: "Install and run.",
        urlPath: "/docs/quickstart",
        absoluteUrl: "https://example.com/docs/quickstart",
        markdownUrlPath: "/docs/quickstart.md",
        markdownAbsoluteUrl: "https://example.com/docs/quickstart.md",
        relativePath: "quickstart",
        groups: ["get-started"],
        lastModified: "2026-05-01T00:00:00.000Z",
      },
    ];

    expect(renderSitemapXml(pages)).toContain(
      "<loc>https://example.com/docs/quickstart</loc>"
    );
    expect(
      renderRobotsTxt({
        baseUrl: "https://example.com",
        sitemapUrlPath: "/sitemap.xml",
      })
    ).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("adds a Schemamap directive when schemamapUrlPath is set", () => {
    const robots = renderRobotsTxt({
      baseUrl: "https://example.com",
      schemamapUrlPath: "/schema-map.xml",
    });
    expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(robots).toContain("Schemamap: https://example.com/schema-map.xml");
    expect(renderRobotsTxt({ baseUrl: "https://example.com" })).not.toContain(
      "Schemamap:"
    );
  });

  it("defaults robots.txt to the balanced Content-Signal policy", () => {
    const robots = renderRobotsTxt({ baseUrl: "https://example.com" });
    expect(robots).toContain(
      "Content-Signal: ai-train=no, search=yes, ai-input=yes"
    );
    // Balanced keeps both retrieval and training crawlers crawlable.
    expect(robots).toContain("User-agent: GPTBot"); // training
    expect(robots).toContain("User-agent: PerplexityBot"); // retrieval
    expect(robots).not.toContain("Disallow: /");
  });

  it("block-training disallows training crawlers but keeps retrieval", () => {
    const robots = renderRobotsTxt({
      baseUrl: "https://example.com",
      policy: "block-training",
    });
    const gptBlock = robots.slice(robots.indexOf("User-agent: GPTBot"));
    expect(gptBlock.startsWith("User-agent: GPTBot\nDisallow: /")).toBe(true);
    const perplexityBlock = robots.slice(
      robots.indexOf("User-agent: PerplexityBot")
    );
    expect(perplexityBlock).toContain("Allow: /");
  });

  it("block-ai disallows every AI crawler and signals no ai use", () => {
    const robots = renderRobotsTxt({
      baseUrl: "https://example.com",
      policy: "block-ai",
    });
    expect(robots).toContain(
      "Content-Signal: ai-train=no, search=yes, ai-input=no"
    );
    expect(robots).toContain("User-agent: GPTBot\nDisallow: /");
    expect(robots).toContain("User-agent: PerplexityBot\nDisallow: /");
  });

  it("signals override individual directives on top of a policy", () => {
    const robots = renderRobotsTxt({
      baseUrl: "https://example.com",
      policy: "balanced",
      signals: { aiTrain: "yes" },
    });
    expect(robots).toContain(
      "Content-Signal: ai-train=yes, search=yes, ai-input=yes"
    );
  });
});

describe("agent readability helpers", () => {
  const manifest = {
    version: 1,
    generatedAt: "2026-05-01T00:00:00.000Z",
    baseUrl: "https://example.com",
    product: { name: "Leadtype", summary: "Docs pipeline." },
    files: {
      robotsTxt: "/robots.txt",
      sitemapMd: "/sitemap.md",
      sitemapXml: "/sitemap.xml",
    },
    navigation: { groups: [], ungrouped: [], unknown: [] },
    pages: [
      {
        title: "Quickstart <start>",
        description: "Install and run.",
        urlPath: "/docs/quickstart",
        absoluteUrl: "https://example.com/docs/quickstart",
        markdownUrlPath: "/docs/quickstart.md",
        markdownAbsoluteUrl: "https://example.com/docs/quickstart.md",
        relativePath: "quickstart",
        groups: ["get-started"],
        lastModified: "2026-05-01T12:00:00.000Z",
      },
      {
        title: "Docs",
        description: "Overview.",
        urlPath: "/docs",
        absoluteUrl: "https://example.com/docs",
        markdownUrlPath: "/docs/index.md",
        markdownAbsoluteUrl: "https://example.com/docs/index.md",
        relativePath: "index",
        groups: [],
        lastModified: "2026-05-01T00:00:00.000Z",
      },
    ],
  } as const;

  it("renders JSON-LD data and safe script tags from manifest pages", () => {
    const page = manifest.pages[0];
    if (!page) {
      throw new Error("missing test page");
    }

    expect(renderJsonLd(page, manifest)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: "Quickstart <start>",
      name: "Quickstart <start>",
      url: "https://example.com/docs/quickstart",
      mainEntityOfPage: "https://example.com/docs/quickstart",
      dateModified: "2026-05-01T12:00:00.000Z",
      // Site entities are referenced by @id, not re-inlined per page.
      isPartOf: { "@id": "https://example.com/#website" },
      publisher: { "@id": "https://example.com/#organization" },
    });
    expect(renderJsonLdScript(page, manifest)).toContain(
      '<script type="application/ld+json">'
    );
    expect(renderJsonLdScript(page, manifest)).toContain(
      "Quickstart \\u003cstart\\u003e"
    );
  });

  it("emits a referenced site-level entity graph", () => {
    const graph = renderSiteJsonLd(manifest, {
      organization: {
        name: "Acme Inc",
        url: "https://acme.com",
        email: "hello@acme.com",
        sameAs: ["https://github.com/acme", "https://www.linkedin.com/acme"],
        contactPoint: {
          contactType: "customer support",
          email: "support@acme.com",
          telephone: "+1-555-0100",
        },
        address: {
          streetAddress: "1 Main Street",
          addressLocality: "San Francisco",
          addressRegion: "CA",
          postalCode: "94105",
          addressCountry: "US",
        },
      },
      software: { applicationCategory: "DeveloperApplication" },
    }) as { "@graph": Record<string, unknown>[] };

    const byType = new Map(
      graph["@graph"].map((node) => [node["@type"], node])
    );
    expect(byType.get("Organization")).toMatchObject({
      "@id": "https://example.com/#organization",
      address: {
        "@type": "PostalAddress",
        streetAddress: "1 Main Street",
        addressLocality: "San Francisco",
        addressRegion: "CA",
        postalCode: "94105",
        addressCountry: "US",
      },
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: "support@acme.com",
          telephone: "+1-555-0100",
        },
      ],
      email: "hello@acme.com",
      name: "Acme Inc",
      sameAs: ["https://github.com/acme", "https://www.linkedin.com/acme"],
      url: "https://acme.com",
    });
    expect(byType.get("WebSite")).toMatchObject({
      "@id": "https://example.com/#website",
      publisher: { "@id": "https://example.com/#organization" },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          urlTemplate: "https://example.com/docs?q={search_term_string}",
        },
      },
    });
    expect(byType.get("SoftwareApplication")).toMatchObject({
      "@id": "https://example.com/#software",
      applicationCategory: "DeveloperApplication",
      publisher: { "@id": "https://example.com/#organization" },
    });
  });

  it("omits an empty contactPoint array from Organization JSON-LD", () => {
    const graph = renderSiteJsonLd(manifest, {
      organization: { name: "Acme Inc", contactPoint: [] },
    }) as { "@graph": Record<string, unknown>[] };
    const organization = graph["@graph"].find(
      (node) => node["@type"] === "Organization"
    );
    expect(organization).not.toHaveProperty("contactPoint");
  });

  it("emits product-detectable software types for libraries and omits the SearchAction on request", () => {
    const graph = renderSiteJsonLd(manifest, {
      software: { isLibrary: true },
      searchUrlPattern: null,
    }) as { "@graph": Record<string, unknown>[] };
    const types = graph["@graph"].flatMap((node) => {
      const type = node["@type"];
      return Array.isArray(type) ? type : [type];
    });
    expect(types).toContain("SoftwareSourceCode");
    expect(types).toContain("SoftwareApplication");
    const website = graph["@graph"].find((node) => node["@type"] === "WebSite");
    expect(website).not.toHaveProperty("potentialAction");
  });

  it("validates JSON-LD structure (validateJsonLd)", () => {
    // A valid TechArticle passes.
    expect(
      validateJsonLd({
        "@context": "https://schema.org",
        "@type": "TechArticle",
        name: "Quickstart",
        dateModified: "2026-05-01T00:00:00.000Z",
      })
    ).toEqual([]);
    // The rendered site graph passes.
    expect(validateJsonLd(renderSiteJsonLd(manifest))).toEqual([]);
    // Missing @context, a bad date, and a nameless article are each flagged.
    expect(validateJsonLd({ "@type": "TechArticle", name: "X" })).toContain(
      "root: missing or empty @context"
    );
    expect(
      validateJsonLd({
        "@context": "https://schema.org",
        "@type": "TechArticle",
        name: "X",
        dateModified: "last tuesday",
      }).some((issue) => issue.includes("dateModified is not a valid date"))
    ).toBe(true);
    expect(
      validateJsonLd({
        "@context": "https://schema.org",
        "@type": "TechArticle",
      }).some((issue) => issue.includes("requires a headline or name"))
    ).toBe(true);
  });

  it("types reference-section pages as APIReference", () => {
    const refManifest = {
      version: 1 as const,
      generatedAt: "2026-05-01T00:00:00.000Z",
      baseUrl: "https://example.com",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      files: {
        robotsTxt: "/robots.txt",
        sitemapMd: "/sitemap.md",
        sitemapXml: "/sitemap.xml",
      },
      navigation: {
        ungrouped: [],
        unknown: [],
        groups: [
          {
            slug: "reference",
            segmentPath: ["reference"],
            title: "Reference",
            pages: [
              {
                urlPath: "/docs/reference/cli",
                relativePath: "reference/cli",
                title: "CLI",
                description: "",
                groups: ["reference"],
                toc: [],
              },
            ],
            children: [],
          },
        ],
      },
      pages: [
        {
          title: "CLI",
          description: "CLI reference.",
          urlPath: "/docs/reference/cli",
          absoluteUrl: "https://example.com/docs/reference/cli",
          markdownUrlPath: "/docs/reference/cli.md",
          markdownAbsoluteUrl: "https://example.com/docs/reference/cli.md",
          relativePath: "reference/cli",
          groups: ["reference"],
          lastModified: "2026-05-01T00:00:00.000Z",
        },
      ],
    };
    const page = refManifest.pages[0];
    if (!page) {
      throw new Error("missing test page");
    }
    expect(renderJsonLd(page, refManifest)["@type"]).toEqual([
      "TechArticle",
      "APIReference",
    ]);
  });

  it("builds a nested breadcrumb trail and articleSection from nav groups", () => {
    const nestedManifest = {
      version: 1,
      generatedAt: "2026-05-01T00:00:00.000Z",
      baseUrl: "https://example.com",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      files: {
        robotsTxt: "/robots.txt",
        sitemapMd: "/sitemap.md",
        sitemapXml: "/sitemap.xml",
      },
      navigation: {
        ungrouped: [],
        unknown: [],
        groups: [
          {
            slug: "docs",
            segmentPath: ["docs"],
            title: "Docs",
            pages: [],
            children: [
              {
                slug: "build",
                segmentPath: ["docs", "build"],
                title: "Build",
                pages: [],
                children: [
                  {
                    slug: "agents",
                    segmentPath: ["docs", "build", "agents"],
                    title: "Agents",
                    pages: [
                      {
                        urlPath: "/docs/build/agents/optimize",
                        relativePath: "build/agents/optimize",
                        title: "Optimize",
                        description: "",
                        groups: ["agents"],
                        toc: [],
                      },
                    ],
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      pages: [
        {
          title: "Optimize",
          description: "Optimize docs for agents.",
          urlPath: "/docs/build/agents/optimize",
          absoluteUrl: "https://example.com/docs/build/agents/optimize",
          markdownUrlPath: "/docs/build/agents/optimize.md",
          markdownAbsoluteUrl:
            "https://example.com/docs/build/agents/optimize.md",
          relativePath: "build/agents/optimize",
          groups: ["agents"],
          lastModified: "2026-05-01T12:00:00.000Z",
        },
        {
          title: "Build",
          description: "Build section landing.",
          urlPath: "/docs/build",
          absoluteUrl: "https://example.com/docs/build",
          markdownUrlPath: "/docs/build/index.md",
          markdownAbsoluteUrl: "https://example.com/docs/build/index.md",
          relativePath: "build/index",
          groups: ["build"],
          lastModified: "2026-05-01T00:00:00.000Z",
        },
      ],
    } as const;

    const page = nestedManifest.pages[0];
    if (!page) {
      throw new Error("missing test page");
    }
    const jsonLd = renderJsonLd(page, nestedManifest);

    // The outermost "Docs" tab (segmentPath ["docs"]) is the breadcrumb home,
    // not a duplicate crumb, and articleSection is the real section.
    expect(jsonLd.articleSection).toBe("Build");

    const breadcrumb = jsonLd.breadcrumb as {
      itemListElement: Array<{ position: number; name: string; item?: string }>;
    };
    expect(breadcrumb.itemListElement.map((entry) => entry.name)).toEqual([
      "Docs",
      "Build",
      "Agents",
      "Optimize",
    ]);
    // Home crumb points to /docs; section crumbs are name-only; leaf is the page.
    expect(breadcrumb.itemListElement[0]?.item).toBe(
      "https://example.com/docs"
    );
    expect(breadcrumb.itemListElement[1]?.item).toBeUndefined();
    expect(breadcrumb.itemListElement[2]?.item).toBeUndefined();
    expect(breadcrumb.itemListElement[3]?.item).toBe(
      "https://example.com/docs/build/agents/optimize"
    );
  });

  it("creates JSON-LD by urlPath and supports safe overrides", () => {
    const jsonLd = createDocsJsonLd({
      urlPath: "/docs/quickstart",
      manifest,
      overrides: ({ page }) => ({
        type: ["TechArticle", "APIReference"],
        author: { "@type": "Organization", name: "Acme Docs" },
        publisher: { "@type": "Organization", name: "Acme" },
        image: "https://example.com/og/docs.png",
        datePublished: "2026-04-01T00:00:00.000Z",
        keywords: ["docs", "quickstart"],
        articleSection: page.groups[0],
        breadcrumb: false,
      }),
    });

    expect(jsonLd).toMatchObject({
      "@type": ["TechArticle", "APIReference"],
      author: { "@type": "Organization", name: "Acme Docs" },
      publisher: { "@type": "Organization", name: "Acme" },
      image: "https://example.com/og/docs.png",
      datePublished: "2026-04-01T00:00:00.000Z",
      keywords: ["docs", "quickstart"],
      articleSection: "get-started",
    });
    expect(jsonLd).not.toHaveProperty("breadcrumb");
  });

  it("returns null for unknown JSON-LD pages", () => {
    expect(createDocsJsonLd({ urlPath: "/docs/nope", manifest })).toBeNull();
  });

  it("escapes JSON-LD script content", () => {
    expect(
      stringifyJsonLd({
        "@context": "https://schema.org",
        headline: "</script><script>x()</script>",
        description: "A & B \u2028 C \u2029 D",
      })
    ).toBe(
      '{"@context":"https://schema.org","headline":"\\u003c/script\\u003e\\u003cscript\\u003ex()\\u003c/script\\u003e","description":"A \\u0026 B \\u2028 C \\u2029 D"}'
    );
  });

  it("resolves markdown mirrors and leaves agent artifacts alone", () => {
    expect(resolveMarkdownMirrorTarget("/docs")).toEqual(
      expect.objectContaining({
        urlPath: "/docs",
        markdownUrlPath: "/docs/index.md",
        filePath: "docs/index.md",
      })
    );
    expect(resolveMarkdownMirrorTarget("/docs.md")).toEqual(
      expect.objectContaining({ filePath: "docs/index.md" })
    );
    expect(resolveMarkdownMirrorTarget("/docs/quickstart.md")).toEqual(
      expect.objectContaining({
        urlPath: "/docs/quickstart",
        filePath: "docs/quickstart.md",
      })
    );
    expect(resolveMarkdownMirrorTarget("/docs/../secret")).toBeNull();
    expect(
      resolveManifestMarkdownMirrorTarget("/docs/quickstart", {
        ...manifest,
        pages: [
          {
            ...manifest.pages[0],
            markdownFilePath: "mirrors/quickstart.md",
          },
        ],
      })
    ).toEqual(expect.objectContaining({ filePath: "mirrors/quickstart.md" }));
    expect(
      resolveManifestMarkdownMirrorTarget("/docs/quickstart", {
        ...manifest,
        pages: [
          {
            ...manifest.pages[0],
            markdownFilePath: "docs/100%-coverage.md",
          },
        ],
      })
    ).toEqual(expect.objectContaining({ filePath: "docs/100%-coverage.md" }));
    expect(
      resolveManifestMarkdownMirrorTarget("/docs/quickstart", {
        ...manifest,
        pages: [{ ...manifest.pages[0], markdownFilePath: "../secret.md" }],
      })
    ).toBeNull();
    for (const markdownFilePath of [
      "%2e%2e/secret.md",
      "%2E./secret.md",
      "docs%5c..%5csecret.md",
    ]) {
      expect(
        resolveManifestMarkdownMirrorTarget("/docs/quickstart", {
          ...manifest,
          pages: [{ ...manifest.pages[0], markdownFilePath }],
        })
      ).toBeNull();
    }
    expect(
      resolveManifestMarkdownMirrorTarget("/docs/quickstart", {
        ...manifest,
        pages: [
          {
            ...manifest.pages[0],
            markdownFilePath: "docs/quickstart%ZZ.md",
          },
        ],
      })
    ).toEqual(expect.objectContaining({ filePath: "docs/quickstart%ZZ.md" }));
    expect(
      resolveManifestMarkdownMirrorTarget("/docs/quickstart", {
        ...manifest,
        pages: [{ ...manifest.pages[0], relativePath: "%2e%2e/secret" }],
      })
    ).toBeNull();
    expect(
      resolveManifestMarkdownMirrorTarget("/docs/quickstart", manifest)
    ).toEqual(expect.objectContaining({ filePath: "docs/quickstart.md" }));
    expect(isAgentReadabilityArtifactPath("/llms.txt")).toBe(true);
    expect(isAgentReadabilityArtifactPath("/docs/search-index.json")).toBe(
      true
    );
  });

  it("detects markdown retrieval requests and builds response headers", () => {
    expect(acceptsMarkdownHeader("text/markdown")).toBe(true);
    expect(acceptsMarkdownHeader("text/plain")).toBe(true);
    // Tied q-values default to HTML (browser-safety bias).
    expect(acceptsMarkdownHeader("text/html, text/markdown")).toBe(false);
    // Markdown wins when explicitly preferred via q-value.
    expect(acceptsMarkdownHeader("text/html;q=0.5, text/markdown")).toBe(true);
    // HTML wins when explicitly preferred.
    expect(acceptsMarkdownHeader("text/html, text/markdown;q=0.5")).toBe(false);
    expect(isAgentUserAgent("ClaudeBot/1.0")).toBe(true);
    expect(isAgentUserAgent("AmazonBot/0.1 (+http://amazon.com/bot)")).toBe(
      true
    );
    expect(isAgentUserAgent("Bingbot/2.0")).toBe(true);
    expect(isAgentUserAgent("PrivateBot/1.0", /privatebot/i)).toBe(true);
    expect(isAgentUserAgent("ChromeBot/1.0")).toBe(false);
    expect(
      createMarkdownResponseHeaders({
        canonicalUrl: "https://example.com/docs",
        includeUserAgentVary: true,
      })
    ).toEqual({
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept, User-Agent",
      Link: '<https://example.com/docs>; rel="canonical", </llms.txt>; rel="llms-txt"',
      "X-Llms-Txt": "/llms.txt",
      "Content-Signal": "ai-train=no, search=yes, ai-input=yes",
      "Cache-Control": "public, max-age=300, must-revalidate",
    });
    // Content-Signal can be customized or omitted.
    expect(
      createMarkdownResponseHeaders({
        canonicalUrl: "https://example.com/docs",
        contentSignal: { search: "yes", aiInput: "no", aiTrain: "no" },
      })["Content-Signal"]
    ).toBe("ai-train=no, search=yes, ai-input=no");
    expect(
      createMarkdownResponseHeaders({
        canonicalUrl: "https://example.com/docs",
        contentSignal: null,
      })
    ).not.toHaveProperty("Content-Signal");
    expect(
      createMarkdownResponseHeaders({
        canonicalUrl: "https://example.com/docs",
        cacheControl: null,
      })
    ).not.toHaveProperty("Cache-Control");
    expect(
      createMarkdownResponseHeaders({
        canonicalUrl: "https://example.com/docs",
        cacheControl: "no-store",
      })["Cache-Control"]
    ).toBe("no-store");
    // llms.txt discovery headers are omitted when llmsTxtPath is null.
    const noDiscovery = createMarkdownResponseHeaders({
      canonicalUrl: "https://example.com/docs",
      llmsTxtPath: null,
    });
    expect(noDiscovery).not.toHaveProperty("X-Llms-Txt");
    expect(noDiscovery.Link).toBe(
      '<https://example.com/docs>; rel="canonical"'
    );
    // A custom llms.txt path is advertised in both Link and X-Llms-Txt.
    const customDiscovery = createMarkdownResponseHeaders({
      canonicalUrl: "https://example.com/docs",
      llmsTxtPath: "/docs/llms.txt",
    });
    expect(customDiscovery["X-Llms-Txt"]).toBe("/docs/llms.txt");
    expect(customDiscovery.Link).toContain('</docs/llms.txt>; rel="llms-txt"');
  });

  it("builds agent discovery Link headers without a docs service-desc", () => {
    // `agent-readability.json` describes documentation, not an API contract,
    // so it is no longer the default `service-desc`.
    expect(createAgentDiscoveryLinkHeader()).toBe(
      '</docs/llms.txt>; rel="service-doc"; type="text/plain", </sitemap.xml>; rel="describedby"; type="application/xml"'
    );
    expect(createAgentDiscoveryHeaders()).toEqual({
      Link: createAgentDiscoveryLinkHeader(),
    });
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: "/.well-known/api-catalog",
      })
    ).toContain('rel="api-catalog"');

    // With a manifest in hand, the header follows what generate actually
    // wrote: no catalog file, no `api-catalog` link to a 404.
    expect(createAgentDiscoveryLinkHeader({ manifest })).toBe(
      '</docs/llms.txt>; rel="service-doc"; type="text/plain", </sitemap.xml>; rel="describedby"; type="application/xml"'
    );
    const staleCatalogManifest = {
      ...manifest,
      files: { ...manifest.files, apiCatalog: "/.well-known/api-catalog" },
    };
    expect(
      createAgentDiscoveryLinkHeader({ manifest: staleCatalogManifest })
    ).not.toContain('rel="api-catalog"');
    expect(
      createAgentDiscoveryLinkHeader({
        manifest: {
          ...staleCatalogManifest,
          apis: [{ href: "/ask" }],
        },
      })
    ).toContain('rel="api-catalog"');

    // A site that has a real API description opts in, media type included.
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "https://api.example.com/openapi.json",
        serviceDescType: "application/vnd.oai.openapi+json;version=3.1",
      })
    ).toBe(
      '<https://api.example.com/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json;version=3.1"'
    );
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "https://api.example.com/open api>v1",
      })
    ).toBe(
      '<https://api.example.com/open%20api%3Ev1>; rel="service-desc"; type="application/json"'
    );
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "https://api.example.com/open|api",
      })
    ).toBe(
      '<https://api.example.com/open%7Capi>; rel="service-desc"; type="application/json"'
    );
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: 'urn:ietf:rfc:9727 api>|"',
      })
    ).toBe(
      '<urn:ietf:rfc:9727%20api%3E%7C%22>; rel="service-desc"; type="application/json"'
    );
    expect(() =>
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "https://",
      })
    ).toThrow(/leadtype: discovery URL is not a valid absolute URL/);
    for (const serviceDescPath of [
      "https:evil.example/x",
      "https:/single-slash/x",
      "ws:evil.example/x",
      "wss:/single-slash/x",
      "ftp:evil.example/x",
      "file:relative/path",
    ]) {
      expect(() =>
        createAgentDiscoveryLinkHeader({
          apiCatalogPath: null,
          serviceDocPath: null,
          describedbyPath: null,
          serviceDescPath,
        })
      ).toThrow(/must use the required slashes after its URL scheme/);
    }
    expect(() =>
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "file:/absolute/path",
      })
    ).not.toThrow();
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "/openapi.json?version=3.1#schema",
      })
    ).toBe(
      '</openapi.json?version=3.1#schema>; rel="service-desc"; type="application/json"'
    );
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "/api|v1/catalog?q=[1]#f|g",
      })
    ).toBe(
      '</api%7Cv1/catalog?q=%5B1%5D#f%7Cg>; rel="service-desc"; type="application/json"'
    );
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath:
          "https://api.example.com/openapi.json?version=3.1#schema",
      })
    ).toBe(
      '<https://api.example.com/openapi.json?version=3.1#schema>; rel="service-desc"; type="application/json"'
    );
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath:
          "//api.example.com:8443/open api>v1?format=json#schema",
      })
    ).toBe(
      '<//api.example.com:8443/open%20api%3Ev1?format=json#schema>; rel="service-desc"; type="application/json"'
    );
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath:
          "/docs/..//api.example.com/openapi.json?version=3.1#schema",
      })
    ).toBe(
      '</.//api.example.com/openapi.json?version=3.1#schema>; rel="service-desc"; type="application/json"'
    );
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "urn:ietf:rfc:9727",
      })
    ).toBe('<urn:ietf:rfc:9727>; rel="service-desc"; type="application/json"');
    for (const [serviceDescPath, expectedTarget] of [
      [
        " https://api.example.com/openapi.json?x=1#schema ",
        "https://api.example.com/openapi.json?x=1#schema",
      ],
      [" urn:ietf:rfc:9727 ", "urn:ietf:rfc:9727"],
      [" //api.example.com/openapi.json ", "//api.example.com/openapi.json"],
      [" /openapi.json ", "/openapi.json"],
    ] as const) {
      expect(
        createAgentDiscoveryLinkHeader({
          apiCatalogPath: null,
          serviceDocPath: null,
          describedbyPath: null,
          serviceDescPath,
        })
      ).toBe(
        `<${expectedTarget}>; rel="service-desc"; type="application/json"`
      );
    }
    expect(() =>
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: " ws:evil.example/x ",
      })
    ).toThrow(/must use the required slashes after its URL scheme/);
    expect(() =>
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "//[bad/openapi.json",
      })
    ).toThrow(/leadtype: discovery URL is not a valid URI-reference/);
    expect(() =>
      createAgentDiscoveryLinkHeader({
        serviceDescPath: "   ",
      })
    ).toThrow(/discovery URL must not be empty/);
    expect(() =>
      createAgentDiscoveryLinkHeader({
        serviceDescPath: "/openapi%ZZ",
      })
    ).toThrow(/malformed percent escape/);
    expect(() =>
      createAgentDiscoveryLinkHeader({
        serviceDescPath: "https://api.example.com/open\napi",
      })
    ).toThrow(/ASCII control characters/);
    expect(() =>
      createAgentDiscoveryLinkHeader({
        serviceDescPath: "/api\uD800v1",
      })
    ).toThrow(/unpaired UTF-16 surrogates/);
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "/api/😀",
      })
    ).toContain("</api/%F0%9F%98%80>");
    expect(() =>
      createAgentDiscoveryLinkHeader({
        serviceDescPath: "/openapi.json",
        serviceDescType: "application/json\r\nX-Injected: yes",
      })
    ).toThrow(/serviceDescType must be a valid ASCII media type/);
    for (const serviceDescType of [
      "application/☃",
      "application/é",
      "application",
      "application/",
      'application/json; profile="unterminated',
    ]) {
      expect(() =>
        createAgentDiscoveryLinkHeader({
          serviceDescPath: "/openapi.json",
          serviceDescType,
        })
      ).toThrow(/serviceDescType must be a valid ASCII media type/);
    }
    expect(
      createAgentDiscoveryLinkHeader({
        apiCatalogPath: null,
        serviceDocPath: null,
        describedbyPath: null,
        serviceDescPath: "/openapi.json",
        serviceDescType:
          'application/json; profile="https://example.com/schema"',
      })
    ).toBe(
      '</openapi.json>; rel="service-desc"; type="application/json; profile=\\"https://example.com/schema\\""'
    );
  });

  it("serves an RFC 9727 catalog response and 404s when no APIs exist", async () => {
    // No configured APIs: nothing to catalog, so the caller can 404 the route.
    expect(
      createApiCatalogResponse({
        manifest,
        requestOrigin: "http://localhost:5173",
      })
    ).toBeNull();
    expect(() => renderApiCatalog({ manifest })).toThrow(
      /at least one API entry/
    );

    const apis = [
      {
        href: "/ask",
        title: "Documentation query API",
        serviceDesc: {
          href: "/openapi.json",
          type: "application/vnd.oai.openapi+json;version=3.1",
        },
      },
    ];
    const response = createApiCatalogResponse({
      manifest,
      apis,
      requestOrigin: "http://localhost:5173",
    });
    expect(response?.headers.get("Content-Type")).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
    );
    expect(response?.headers.get("Link")).toBe(
      '<http://localhost:5173/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"'
    );
    const body = await response?.json();
    expect(body.linkset[0].anchor).toBe(
      "http://localhost:5173/.well-known/api-catalog"
    );
    expect(body.linkset[0].item).toEqual([
      {
        href: "http://localhost:5173/ask",
        title: "Documentation query API",
      },
    ]);
    expect(body.linkset[1]["service-desc"][0].href).toBe(
      "http://localhost:5173/openapi.json"
    );

    // HEAD keeps every header — including the self-referential api-catalog
    // Link RFC 9727 §2 requires — but carries no body.
    const head = createApiCatalogResponse({
      manifest,
      apis,
      method: "head",
      requestOrigin: "http://localhost:5173",
    });
    expect(head?.headers.get("Link")).toBe(response?.headers.get("Link"));
    expect(head?.headers.get("Content-Type")).toBe(
      response?.headers.get("Content-Type")
    );
    expect(head?.body).toBeNull();
    expect(await head?.text()).toBe("");
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect(
        createApiCatalogResponse({
          manifest,
          apis,
          method,
          requestOrigin: "http://localhost:5173",
        })
      ).toBeNull();
    }
  });

  it("resolves catalog hrefs relative to the serving origin", () => {
    const catalog = JSON.parse(
      renderApiCatalog({
        manifest,
        // Root-relative, document-relative, and cross-origin all resolve.
        apis: [
          { href: "/ask" },
          { href: "v2/ask" },
          { href: "https://api.example.com/open api" },
          {
            href: "https://api.partner.example/graphql",
            serviceDoc: { href: "https://partner.example/docs" },
          },
        ],
      })
    );
    expect(
      catalog.linkset[0].item.map((item: { href: string }) => item.href)
    ).toEqual([
      "https://example.com/ask",
      "https://example.com/v2/ask",
      "https://api.example.com/open%20api",
      "https://api.partner.example/graphql",
    ]);
    expect(catalog.linkset[1]).toEqual({
      anchor: "https://api.partner.example/graphql",
      "service-doc": [{ href: "https://partner.example/docs" }],
    });
    expect(() =>
      renderApiCatalog({ manifest, apis: [{ href: "/api%ZZ" }] })
    ).toThrow(/malformed percent escape/);
    expect(() =>
      renderApiCatalog({ manifest, apis: [{ href: "https://" }] })
    ).toThrow(/leadtype: API catalog href is not a valid URL/);
    expect(() =>
      renderApiCatalog({ manifest, apis: [{ href: "/api\\v1" }] })
    ).toThrow(/must not contain backslashes/);
    expect(() =>
      renderApiCatalog({ manifest, apis: [{ href: "   " }] })
    ).toThrow(/must not be empty/);
    expect(() =>
      renderApiCatalog({
        manifest,
        apis: [{ href: "/ask", serviceDoc: { href: "   " } }],
      })
    ).toThrow(/must not be empty/);
    expect(() =>
      renderApiCatalog({ manifest, apis: [{ href: "/api\nx" }] })
    ).toThrow(/ASCII control character/);
    expect(() =>
      renderApiCatalog({ manifest, apis: [{ href: "/api\uD800v1" }] })
    ).toThrow(/unpaired UTF-16 surrogates/);
    expect(() =>
      renderApiCatalog({
        manifest,
        apis: [{ href: "/ask", serviceDesc: { href: "/openapi\tx" } }],
      })
    ).toThrow(/ASCII control character/);
    expect(() =>
      renderApiCatalog({
        manifest,
        apis: [{ href: "/ask", serviceDesc: { href: "/open\uDC00api" } }],
      })
    ).toThrow(/unpaired UTF-16 surrogates/);
    expect(
      renderApiCatalog({ manifest, apis: [{ href: "/api/😀" }] })
    ).toContain("https://example.com/api/%F0%9F%98%80");
  });

  it("percent-encodes RFC 3986-illegal ASCII in catalog URL components", () => {
    const catalog = renderApiCatalog({
      manifest: {
        ...manifest,
        apis: [
          {
            href: "/api|v1?q=^`{|}[]#schema|v1",
            serviceDesc: {
              href: "https://[2001:db8::1]/openapi|v1.json",
            },
          },
        ],
      },
    });

    expect(catalog).toContain(
      "https://example.com/api%7Cv1?q=%5E%60%7B%7C%7D%5B%5D#schema%7Cv1"
    );
    expect(catalog).toContain("https://[2001:db8::1]/openapi%7Cv1.json");
  });

  it("percent-encodes RFC 3986-illegal ASCII in opaque catalog URLs", () => {
    const catalog = renderApiCatalog({
      manifest,
      apis: [{ href: 'urn:ietf:rfc:9727 api>|"' }, { href: "mailto:a|b" }],
    });

    expect(catalog).toContain("urn:ietf:rfc:9727%20api%3E%7C%22");
    expect(catalog).toContain("mailto:a%7Cb");
  });

  it("rejects special-scheme catalog URLs with missing slashes", () => {
    for (const href of [
      "https:api.example/v1",
      "ws:api.example/socket",
      "wss:/api.example/socket",
      "ftp:api.example/file",
      "file:relative/path",
    ]) {
      expect(() => renderApiCatalog({ manifest, apis: [{ href }] })).toThrow(
        /must use the required slashes after its URL scheme/
      );
    }
    expect(() =>
      renderApiCatalog({ manifest, apis: [{ href: "file:/absolute/path" }] })
    ).not.toThrow();
  });

  it("rejects malformed API catalog media types", () => {
    for (const type of [
      "",
      "not a media type",
      "application/☃",
      'application/json; profile="unterminated',
    ]) {
      expect(() =>
        renderApiCatalog({ manifest, apis: [{ href: "/ask", type }] })
      ).toThrow(/API catalog item type must be a valid ASCII media type/);
      expect(() =>
        renderApiCatalog({
          manifest,
          apis: [{ href: "/ask", serviceDesc: { href: "/openapi", type } }],
        })
      ).toThrow(/API catalog link type must be a valid ASCII media type/);
    }
  });

  it("preserves the manifest base path when rebasing the request origin", () => {
    const catalog = JSON.parse(
      renderApiCatalog({
        manifest: {
          ...manifest,
          baseUrl: "https://preview.example/product/",
          apis: [{ href: "ask" }],
        },
        requestOrigin: "https://docs.example",
      })
    );

    expect(catalog.linkset[0].item).toEqual([
      { href: "https://docs.example/product/ask" },
    ]);
  });

  it("deduplicates catalog hrefs after applying the request origin", () => {
    const catalog = JSON.parse(
      renderApiCatalog({
        manifest: { ...manifest, baseUrl: "http://localhost:3000" },
        requestOrigin: "https://acme.dev",
        apis: [
          { href: "https://acme.dev/ask", title: "Authored API" },
          {
            href: "/ask",
            serviceDesc: { href: "/openapi.json" },
          },
        ],
      })
    );
    expect(catalog.linkset[0].item).toEqual([
      { href: "https://acme.dev/ask", title: "Authored API" },
    ]);
    expect(catalog.linkset[1]).toEqual({
      anchor: "https://acme.dev/ask",
      "service-desc": [{ href: "https://acme.dev/openapi.json" }],
    });
  });

  it("merges and deduplicates relations from equivalent catalog entries", () => {
    const catalog = JSON.parse(
      renderApiCatalog({
        manifest,
        apis: [
          {
            href: "/ask",
            title: "Authored API",
            serviceDesc: [
              {
                href: "/openapi.json",
                title: "Authored description",
              },
              { href: "/asyncapi.json" },
            ],
          },
          {
            href: "https://example.com/ask",
            title: "Generated API",
            type: "application/json",
            version: "1.0",
            serviceDesc: [
              {
                href: "https://example.com/openapi.json",
                title: "Duplicate description",
                type: "application/vnd.oai.openapi+json;version=3.1",
              },
              { href: "/schema.json" },
            ],
          },
        ],
      })
    );

    expect(catalog.linkset[0].item).toEqual([
      {
        href: "https://example.com/ask",
        title: "Authored API",
        type: "application/json",
        version: ["1.0"],
      },
    ]);
    expect(catalog.linkset[1]).toEqual({
      anchor: "https://example.com/ask",
      "service-desc": [
        {
          href: "https://example.com/openapi.json",
          title: "Authored description",
          type: "application/vnd.oai.openapi+json;version=3.1",
        },
        { href: "https://example.com/asyncapi.json" },
        { href: "https://example.com/schema.json" },
      ],
    });
  });

  it("adds agent-readable frontmatter aliases to markdown", () => {
    const markdown = `---
title: Quickstart
description: Install.
lastModified: 2026-05-01T12:00:00.000Z
---
# Quickstart
`;

    expect(
      enrichMarkdownFrontmatter(markdown, {
        canonicalUrl: "https://example.com/docs/quickstart",
      })
    ).toContain(
      'canonical_url: "https://example.com/docs/quickstart"\nlast_updated: "2026-05-01T12:00:00.000Z"'
    );
  });

  it("creates complete markdown responses for docs and agent 404s", async () => {
    const markdown = `---
title: Quickstart
description: Install.
lastModified: 2026-05-01T12:00:00.000Z
---
# Quickstart
`;

    const docsResponse = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart",
      headers: { "user-agent": "ClaudeBot/1.0" },
      manifest,
      readMarkdownFile: () => markdown,
    });

    expect(docsResponse).not.toBeNull();
    expect(docsResponse?.status).toBe(200);
    expect(docsResponse?.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(docsResponse?.headers.get("Vary")).toBe("Accept, User-Agent");
    expect(docsResponse?.headers.get("Cache-Control")).toBe(
      "public, max-age=300, must-revalidate"
    );
    const docsBody = await docsResponse?.text();
    expect(docsBody).toContain("# Quickstart");
    expect(docsBody).toContain("canonical_url:");

    let indexTarget: string | undefined;
    const indexAliasResponse = await createAgentMarkdownResponse({
      urlPath: "/docs.md",
      headers: {},
      manifest,
      readMarkdownFile: (target) => {
        indexTarget = target.filePath;
        return "# Docs\n";
      },
    });
    expect(indexAliasResponse?.status).toBe(200);
    expect(indexTarget).toBe("docs/index.md");
    expect(indexAliasResponse?.headers.get("Link")).toContain(
      '<https://example.com/docs>; rel="canonical"'
    );

    const missingResponse = await createAgentMarkdownResponse({
      urlPath: "/missing-page",
      headers: { accept: "text/markdown" },
      manifest,
      requestOrigin: "http://localhost:3000",
      now: new Date("2026-05-02T00:00:00.000Z"),
      readMarkdownFile: () => null,
    });

    expect(missingResponse).not.toBeNull();
    expect(missingResponse?.status).toBe(200);
    expect(missingResponse?.headers.get("Link")).toBe(
      '<http://localhost:3000/missing-page>; rel="canonical", </llms.txt>; rel="llms-txt"'
    );
    expect(missingResponse?.headers.get("X-Llms-Txt")).toBe("/llms.txt");
    const missingBody = await missingResponse?.text();
    expect(missingBody).toContain("# Page not found");

    expect(
      renderMissingMarkdown({
        urlPath: "/missing-page",
        canonicalUrl: "https://example.com/missing-page",
        lastUpdated: "2026-05-02T00:00:00.000Z",
      })
    ).toContain('last_updated: "2026-05-02T00:00:00.000Z"');
  });

  const manifestWithoutPageLastModified = () =>
    ({
      ...manifest,
      pages: [
        {
          ...manifest.pages[0],
          lastModified: undefined,
        },
      ],
    }) as unknown as typeof manifest;

  it("uses now when enriching markdown without page freshness metadata", async () => {
    const response = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart",
      headers: { accept: "text/markdown" },
      manifest: manifestWithoutPageLastModified(),
      now: new Date("2026-05-03T00:00:00.000Z"),
      readMarkdownFile: () => "---\ntitle: Quickstart\n---\n# Quickstart\n",
    });

    expect(await response?.text()).toContain(
      'last_updated: "2026-05-03T00:00:00.000Z"'
    );
  });

  it("prefers a mirror's authored frontmatter date over now", async () => {
    const response = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart",
      headers: { accept: "text/markdown" },
      manifest: manifestWithoutPageLastModified(),
      now: new Date("2026-05-03T00:00:00.000Z"),
      readMarkdownFile: () =>
        "---\ntitle: Quickstart\nlastModified: 2026-04-01T00:00:00.000Z\n---\n# Quickstart\n",
    });

    expect(await response?.text()).toContain(
      'last_updated: "2026-04-01T00:00:00.000Z"'
    );
  });

  it("supports async readMarkdownFile for edge runtimes", async () => {
    const response = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart",
      headers: { "user-agent": "ClaudeBot/1.0" },
      manifest,
      readMarkdownFile: () =>
        Promise.resolve("---\ntitle: Quickstart\n---\n# Quickstart from KV\n"),
    });
    expect(await response?.text()).toContain("# Quickstart from KV");
  });

  it("serves generated mirror filenames containing literal percent signs", async () => {
    let mirrorTarget = "";
    const response = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart.md",
      headers: {},
      manifest: {
        ...manifest,
        pages: [
          {
            ...manifest.pages[0],
            markdownFilePath: "docs/100%-coverage.md",
          },
        ],
      },
      readMarkdownFile: (target) => {
        mirrorTarget = target.filePath;
        return "# Percent coverage\n";
      },
    });

    expect(response?.status).toBe(200);
    expect(mirrorTarget).toBe("docs/100%-coverage.md");
    expect(await response?.text()).toContain("# Percent coverage");
  });

  it("reads root-relative mirrors from legacy BYOP manifests", async () => {
    const legacyByopManifest = {
      ...manifest,
      pages: [
        {
          ...manifest.pages[0],
          urlPath: "/benchmarks/chrome",
          absoluteUrl: "https://example.com/benchmarks/chrome",
          markdownUrlPath: "/benchmarks/chrome.md",
          markdownAbsoluteUrl: "https://example.com/benchmarks/chrome.md",
          relativePath: "benchmarks/chrome",
        },
        {
          ...manifest.pages[0],
          urlPath: "/",
          absoluteUrl: "https://example.com/",
          markdownUrlPath: "/index.md",
          markdownAbsoluteUrl: "https://example.com/index.md",
          relativePath: "index",
        },
      ],
    };
    const reads: string[] = [];
    const readMarkdownFile = (target: MarkdownMirrorTarget): string | null => {
      reads.push(target.filePath);
      if (target.filePath.startsWith("docs/")) {
        return null;
      }
      const page = legacyByopManifest.pages.find(
        (candidate) => candidate.relativePath === target.relativePath
      );
      if (!page) {
        return null;
      }
      return `---
canonical_url: "${page.absoluteUrl}"
last_updated: "${page.lastModified}"
---
# ${target.relativePath}`;
    };

    const leafResponse = await createAgentMarkdownResponse({
      urlPath: "/benchmarks/chrome.md",
      headers: {},
      manifest: legacyByopManifest,
      readMarkdownFile,
    });
    const rootResponse = await createAgentMarkdownResponse({
      urlPath: "/index.md",
      headers: {},
      manifest: legacyByopManifest,
      readMarkdownFile,
    });

    expect(leafResponse?.status).toBe(200);
    expect(rootResponse?.status).toBe(200);
    expect(reads).toEqual([
      "docs/benchmarks/chrome.md",
      "benchmarks/chrome.md",
      "docs/index.md",
      "index.md",
    ]);
  });

  it("retries legacy BYOP root mirrors after a guessed-path read error", async () => {
    const primaryReadError = new Error("unexpected HTML fallback");
    const reads: string[] = [];
    const reportedErrors: unknown[] = [];
    const response = await createAgentMarkdownResponse({
      urlPath: "/benchmarks/chrome.md",
      headers: {},
      manifest: {
        ...manifest,
        pages: [
          {
            ...manifest.pages[0],
            urlPath: "/benchmarks/chrome",
            absoluteUrl: "https://example.com/benchmarks/chrome",
            markdownUrlPath: "/benchmarks/chrome.md",
            markdownAbsoluteUrl: "https://example.com/benchmarks/chrome.md",
            relativePath: "benchmarks/chrome",
          },
        ],
      },
      readMarkdownFile: (target) => {
        reads.push(target.filePath);
        if (target.filePath.startsWith("docs/")) {
          throw primaryReadError;
        }
        return `---
canonical_url: "https://example.com/benchmarks/chrome"
last_updated: "2026-05-01T12:00:00.000Z"
---
# Chrome benchmarks
`;
      },
      onReadError: (_target, cause) => {
        reportedErrors.push(cause);
      },
    });

    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain("# Chrome benchmarks");
    expect(reads).toEqual([
      "docs/benchmarks/chrome.md",
      "benchmarks/chrome.md",
    ]);
    expect(reportedErrors).toEqual([]);
  });

  it("refuses stale root files from legacy mounted docs-tree manifests", async () => {
    const reads: string[] = [];
    const response = await createAgentMarkdownResponse({
      urlPath: "/changelog/v1.md",
      headers: {},
      manifest: {
        ...manifest,
        pages: [
          {
            ...manifest.pages[0],
            title: "Version 1",
            urlPath: "/changelog/v1",
            absoluteUrl: "https://example.com/changelog/v1",
            markdownUrlPath: "/changelog/v1.md",
            markdownAbsoluteUrl: "https://example.com/changelog/v1.md",
            relativePath: "changelog/v1",
          },
        ],
      },
      readMarkdownFile: (target) => {
        reads.push(target.filePath);
        if (target.filePath.startsWith("docs/")) {
          return null;
        }
        return `---
canonical_url: "https://example.com/changelog/v1"
last_updated: "2026-04-01T12:00:00.000Z"
---
# Stale root copy
`;
      },
    });

    expect(response?.status).toBe(500);
    expect(await response?.text()).not.toContain("# Stale root copy");
    expect(reads).toEqual(["docs/changelog/v1.md", "changelog/v1.md"]);
  });

  it("reports a guessed-path read error when its legacy retry also fails", async () => {
    const primaryReadError = new Error("unexpected HTML fallback");
    const reported: Array<{
      target: MarkdownReadErrorTarget;
      cause: unknown;
    }> = [];
    const response = await createAgentMarkdownResponse({
      urlPath: "/benchmarks/chrome.md",
      headers: {},
      manifest: {
        ...manifest,
        pages: [
          {
            ...manifest.pages[0],
            urlPath: "/benchmarks/chrome",
            absoluteUrl: "https://example.com/benchmarks/chrome",
            markdownUrlPath: "/benchmarks/chrome.md",
            markdownAbsoluteUrl: "https://example.com/benchmarks/chrome.md",
            relativePath: "benchmarks/chrome",
          },
        ],
      },
      readMarkdownFile: (target) => {
        if (target.filePath.startsWith("docs/")) {
          throw primaryReadError;
        }
        return null;
      },
      onReadError: (target, cause) => {
        reported.push({ target, cause });
      },
    });

    expect(response?.status).toBe(500);
    expect(reported).toEqual([
      {
        target: {
          urlPath: "/benchmarks/chrome",
          markdownUrlPath: "/benchmarks/chrome.md",
          filePath: "docs/benchmarks/chrome.md",
          relativePath: "benchmarks/chrome",
        },
        cause: primaryReadError,
      },
    ]);
  });

  it("answers 500 when a manifest-known page's mirror cannot be read", async () => {
    // The manifest promised /docs/quickstart. An unreadable mirror is a broken
    // build, so the response must not claim the page is missing.
    for (const urlPath of ["/docs/quickstart", "/docs/quickstart.md"]) {
      const response = await createAgentMarkdownResponse({
        urlPath,
        headers: { accept: "text/markdown" },
        manifest,
        requestOrigin: "http://localhost:3000",
        now: new Date("2026-05-02T00:00:00.000Z"),
        readMarkdownFile: () => null,
      });

      expect(response?.status).toBe(500);
      expect(response?.headers.get("Cache-Control")).toBe("no-store");
      expect(response?.headers.get("Content-Type")).toBe(
        "text/markdown; charset=utf-8"
      );
      expect(response?.headers.get("Link")).toBe(
        '<https://example.com/docs/quickstart>; rel="canonical", </llms.txt>; rel="llms-txt"'
      );
      expect(response?.headers.get("X-Llms-Txt")).toBe("/llms.txt");
      const body = await response?.text();
      expect(body).toContain("# Markdown temporarily unavailable");
      expect(body).toContain("/docs/quickstart.md");
      expect(body).toContain(
        'canonical_url: "https://example.com/docs/quickstart"'
      );
      expect(body).not.toContain("# Page not found");
    }

    const readError = new Error("EACCES");
    let reportedError: unknown;
    let reportedTargetFilePath: string | undefined;
    let reportingFinished = false;
    const rejected = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart.md",
      headers: {},
      manifest,
      readMarkdownFile: () => Promise.reject(readError),
      onReadError: async (target, cause) => {
        await Promise.resolve();
        reportedError = cause;
        reportedTargetFilePath = target.filePath;
        reportingFinished = true;
      },
    });
    expect(rejected?.status).toBe(500);
    expect(rejected?.headers.get("Cache-Control")).toBe("no-store");
    expect(await rejected?.text()).toContain(
      "# Markdown temporarily unavailable"
    );
    expect(reportedError).toBe(readError);
    expect(reportedTargetFilePath).toBe("docs/quickstart.md");
    expect(reportingFinished).toBe(true);

    const failedReporter = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart.md",
      headers: {},
      manifest,
      readMarkdownFile: () => Promise.reject(new Error("EIO")),
      onReadError: () => Promise.reject(new Error("reporter unavailable")),
    });
    expect(failedReporter?.status).toBe(500);
    expect(await failedReporter?.text()).toContain(
      "# Markdown temporarily unavailable"
    );

    // A caller's Cache-Control never applies to the failure — an integrity
    // error must not be cached.
    const cached = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart.md",
      headers: {},
      manifest,
      cacheControl: "public, max-age=86400",
      readMarkdownFile: () => null,
    });
    expect(cached?.headers.get("Cache-Control")).toBe("no-store");

    // HEAD keeps the status and headers, drops the body.
    const head = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart.md",
      method: "HEAD",
      headers: {},
      manifest,
      readMarkdownFile: () => null,
    });
    expect(head?.status).toBe(500);
    expect(head?.headers.get("Cache-Control")).toBe("no-store");
    expect(await head?.text()).toBe("");

    let missingReadCause: unknown = "not-called";
    const missingRead = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart.md",
      headers: {},
      manifest,
      readMarkdownFile: () => null,
      onReadError: (_target, cause) => {
        missingReadCause = cause;
      },
    });
    expect(missingRead?.status).toBe(500);
    expect(missingReadCause).toBeUndefined();

    let unsafeMirrorReads = 0;
    let invalidReportedTarget: MarkdownReadErrorTarget | undefined;
    let invalidTargetCause: unknown;
    const invalidExplicitTarget = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart.md",
      headers: {},
      manifest: {
        ...manifest,
        pages: [{ ...manifest.pages[0], markdownFilePath: "../secret.md" }],
      },
      readMarkdownFile: () => {
        unsafeMirrorReads += 1;
        return "# Stale guessed mirror";
      },
      onReadError: (target, cause) => {
        invalidReportedTarget = target;
        invalidTargetCause = cause;
      },
    });
    expect(invalidExplicitTarget?.status).toBe(500);
    expect(invalidExplicitTarget?.headers.get("Cache-Control")).toBe(
      "no-store"
    );
    expect(await invalidExplicitTarget?.text()).toContain(
      "# Markdown temporarily unavailable"
    );
    expect(unsafeMirrorReads).toBe(0);
    expect(invalidReportedTarget).toEqual({
      urlPath: "/docs/quickstart",
      markdownUrlPath: "/docs/quickstart.md",
      relativePath: "quickstart",
    });
    expect(invalidReportedTarget?.filePath).toBeUndefined();
    expect(invalidTargetCause).toBeInstanceOf(Error);
    expect((invalidTargetCause as Error).message).toContain(
      "invalid markdown mirror target"
    );
    expect((invalidTargetCause as Error).message).toContain("../secret.md");

    // A readable mirror is untouched by any of this.
    const ok = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart.md",
      headers: {},
      manifest,
      readMarkdownFile: () => "---\ntitle: Quickstart\n---\n# Quickstart\n",
    });
    expect(ok?.status).toBe(200);
    expect(ok?.headers.get("Cache-Control")).toBe(
      "public, max-age=300, must-revalidate"
    );
  });

  it("resolves cross-locale mirrors only through supplied locale manifests", async () => {
    const defaultLocaleManifest = {
      ...manifest,
      locale: "en",
      i18n: {
        version: 1 as const,
        defaultLocale: "en",
        locales: [{ code: "en" }, { code: "zh" }],
        artifacts: [
          {
            locale: "en",
            urlPrefix: "/docs",
            agentReadabilityManifest: "/docs/agent-readability.json",
          },
          {
            locale: "zh",
            urlPrefix: "/docs/zh",
            agentReadabilityManifest: "/docs/zh/agent-readability.json",
          },
        ],
      },
    };
    const zhManifest = {
      ...manifest,
      locale: "zh",
      pages: [
        {
          ...manifest.pages[0],
          title: "指南",
          urlPath: "/docs/zh/guides",
          absoluteUrl: "https://example.com/docs/zh/guides",
          markdownUrlPath: "/docs/zh/guides.md",
          markdownAbsoluteUrl: "https://example.com/docs/zh/guides.md",
          markdownFilePath: "docs/zh/guides/index.md",
          relativePath: "zh/guides/index",
          locale: "zh",
        },
      ],
    };

    let localizedMirrorTarget = "";
    const localized = await createAgentMarkdownResponse({
      urlPath: "/docs/zh/guides.md",
      headers: {},
      manifest: defaultLocaleManifest,
      localizedManifests: { zh: zhManifest },
      missingStatus: 404,
      readMarkdownFile: (target) => {
        localizedMirrorTarget = target.filePath;
        return "---\ntitle: 快速开始\n---\n# 快速开始";
      },
    });
    expect(localized?.status).toBe(200);
    expect(await localized?.text()).toContain("# 快速开始");
    expect(localizedMirrorTarget).toBe("docs/zh/guides/index.md");

    const mountedZhManifest = {
      ...zhManifest,
      pages: [
        {
          ...zhManifest.pages[0],
          title: "更新日志",
          urlPath: "/changelog/zh/v1",
          absoluteUrl: "https://example.com/changelog/zh/v1",
          markdownUrlPath: "/changelog/zh/v1.md",
          markdownAbsoluteUrl: "https://example.com/changelog/zh/v1.md",
          markdownFilePath: "docs/changelog/zh/v1.md",
          relativePath: "changelog/zh/v1",
        },
      ],
    };
    const mounted = await createAgentMarkdownResponse({
      urlPath: "/changelog/zh/v1.md",
      headers: {},
      manifest: defaultLocaleManifest,
      localizedManifests: { zh: mountedZhManifest },
      missingStatus: 404,
      readMarkdownFile: (target) => {
        localizedMirrorTarget = target.filePath;
        return "# 更新日志";
      },
    });
    expect(mounted?.status).toBe(200);
    expect(await mounted?.text()).toContain("# 更新日志");
    expect(localizedMirrorTarget).toBe("docs/changelog/zh/v1.md");

    let staleMirrorReads = 0;
    const absentPage = await createAgentMarkdownResponse({
      urlPath: "/docs/zh/deleted.md",
      headers: {},
      manifest: defaultLocaleManifest,
      localizedManifests: { zh: zhManifest },
      missingStatus: 404,
      readMarkdownFile: () => {
        staleMirrorReads += 1;
        return "# Stale localized mirror";
      },
    });
    expect(absentPage?.status).toBe(404);
    expect(await absentPage?.text()).toContain("# Page not found");
    expect(staleMirrorReads).toBe(0);

    const absentManifest = await createAgentMarkdownResponse({
      urlPath: "/docs/zh/guides.md",
      headers: {},
      manifest: defaultLocaleManifest,
      missingStatus: 404,
      readMarkdownFile: () => {
        staleMirrorReads += 1;
        return "# Unverified localized mirror";
      },
    });
    expect(absentManifest?.status).toBe(404);
    expect(await absentManifest?.text()).toContain("# Page not found");
    expect(staleMirrorReads).toBe(0);

    const currentZhManifest = {
      ...defaultLocaleManifest,
      locale: "zh",
      pages: [],
    };
    const staleDefaultManifest = {
      ...zhManifest,
      locale: "en",
    };
    const currentLocaleMissing = await createAgentMarkdownResponse({
      urlPath: "/docs/zh/guides.md",
      headers: {},
      manifest: currentZhManifest,
      localizedManifests: { en: staleDefaultManifest },
      missingStatus: 404,
      readMarkdownFile: () => {
        staleMirrorReads += 1;
        return "# Stale default-locale mirror";
      },
    });
    expect(currentLocaleMissing?.status).toBe(404);
    expect(await currentLocaleMissing?.text()).toContain("# Page not found");
    expect(staleMirrorReads).toBe(0);

    await expect(
      createAgentMarkdownResponse({
        urlPath: "/docs/zh/guides.md",
        headers: {},
        manifest: defaultLocaleManifest,
        localizedManifests: {
          zh: { ...zhManifest, version: 2 } as unknown as typeof zhManifest,
        },
        readMarkdownFile: () => "# Must not be read",
      })
    ).rejects.toThrow(/manifest version 2 is not supported/);

    await expect(
      createAgentMarkdownResponse({
        urlPath: "/docs/zh/guides.md",
        headers: {},
        manifest: defaultLocaleManifest,
        localizedManifests: { zh: { ...zhManifest, locale: "fr" } },
        readMarkdownFile: () => "# Must not be read",
      })
    ).rejects.toThrow('localized manifest for "zh" reports locale "fr"');
  });

  it("keeps unknown routes at 200 by default and honors missingStatus: 404", async () => {
    let staleMirrorReads = 0;
    for (const request of [
      { urlPath: "/docs/deleted.md", headers: {} },
      { urlPath: "/docs/deleted", headers: { accept: "text/markdown" } },
    ]) {
      const deleted = await createAgentMarkdownResponse({
        ...request,
        manifest,
        missingStatus: 404,
        readMarkdownFile: () => {
          staleMirrorReads += 1;
          return "# Deleted but still on disk";
        },
      });
      expect(deleted?.status).toBe(404);
      const body = await deleted?.text();
      expect(body).toContain("# Page not found");
      expect(body).not.toContain("still on disk");
    }
    expect(staleMirrorReads).toBe(0);

    // Three shapes of "genuinely unknown": an explicit .md path, Accept
    // negotiation, and a bare AI user-agent.
    const unknownRequests = [
      { urlPath: "/docs/nope.md", headers: {} },
      { urlPath: "/changelog/nope.md", headers: {} },
      { urlPath: "/nope", headers: { accept: "text/markdown" } },
      { urlPath: "/nope", headers: { "user-agent": "ClaudeBot/1.0" } },
    ];

    for (const request of unknownRequests) {
      const soft = await createAgentMarkdownResponse({
        ...request,
        manifest,
        readMarkdownFile: () => null,
      });
      expect(soft?.status).toBe(200);
      expect(await soft?.text()).toContain("# Page not found");

      const hard = await createAgentMarkdownResponse({
        ...request,
        manifest,
        missingStatus: 404,
        readMarkdownFile: () => null,
      });
      expect(hard?.status).toBe(404);
      // The recovery body survives the harder status.
      const body = await hard?.text();
      expect(body).toContain("# Page not found");
      expect(body).toContain("/llms.txt");
      expect(hard?.headers.get("Content-Type")).toBe(
        "text/markdown; charset=utf-8"
      );
      expect(hard?.headers.get("X-Llms-Txt")).toBe("/llms.txt");
    }

    // HEAD carries the chosen status with no body.
    const head = await createAgentMarkdownResponse({
      urlPath: "/docs/nope.md",
      method: "HEAD",
      headers: {},
      manifest,
      missingStatus: 404,
      readMarkdownFile: () => null,
    });
    expect(head?.status).toBe(404);
    expect(await head?.text()).toBe("");

    // An existing page is unaffected by the option.
    const existing = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart.md",
      headers: {},
      manifest,
      missingStatus: 404,
      readMarkdownFile: () => "---\ntitle: Quickstart\n---\n# Quickstart\n",
    });
    expect(existing?.status).toBe(200);

    // Non-agent requests still fall through to the host app's routing.
    expect(
      await createAgentMarkdownResponse({
        urlPath: "/nope",
        headers: { accept: "text/html" },
        manifest,
        missingStatus: 404,
        readMarkdownFile: () => null,
      })
    ).toBeNull();
  });

  it("keeps 308 and 410 ahead of missingStatus", async () => {
    const redirects = [
      { from: "/docs/old-quickstart", to: "/docs/quickstart", status: 308 },
      { from: "/docs/legacy", status: 410 },
    ];

    const moved = await createAgentMarkdownResponse({
      urlPath: "/docs/old-quickstart",
      headers: { accept: "text/markdown" },
      manifest,
      redirects,
      missingStatus: 404,
      readMarkdownFile: () => null,
    });
    expect(moved?.status).toBe(308);

    const gone = await createAgentMarkdownResponse({
      urlPath: "/docs/legacy",
      headers: { accept: "text/markdown" },
      manifest,
      redirects,
      missingStatus: 404,
      readMarkdownFile: () => null,
    });
    expect(gone?.status).toBe(410);
  });

  it("redirects agent requests for renamed pages, including .md mirrors", async () => {
    const redirects = [
      { from: "/docs/old-quickstart", to: "/docs/quickstart", status: 308 },
      { from: "/docs/legacy", status: 410 },
    ];

    const moved = await createAgentMarkdownResponse({
      urlPath: "/docs/old-quickstart",
      headers: { accept: "text/markdown" },
      manifest,
      redirects,
      readMarkdownFile: () => null,
    });
    expect(moved?.status).toBe(308);
    expect(moved?.headers.get("location")).toBe(
      "https://example.com/docs/quickstart"
    );

    const mirror = await createAgentMarkdownResponse({
      urlPath: "/docs/old-quickstart.md",
      headers: {},
      manifest,
      redirects,
      readMarkdownFile: () => null,
    });
    expect(mirror?.status).toBe(308);
    expect(mirror?.headers.get("location")).toBe(
      "https://example.com/docs/quickstart.md"
    );

    const gone = await createAgentMarkdownResponse({
      urlPath: "/docs/legacy",
      headers: { accept: "text/markdown" },
      manifest,
      redirects,
      readMarkdownFile: () => null,
    });
    expect(gone?.status).toBe(410);

    // Non-agent requests fall through so the host app's HTML routing runs.
    const html = await createAgentMarkdownResponse({
      urlPath: "/docs/old-quickstart",
      headers: { accept: "text/html" },
      manifest,
      redirects,
      readMarkdownFile: () => null,
    });
    expect(html).toBeNull();
  });

  it("redirects .md requests to the target's recorded mirror for index routes", async () => {
    const manifestWithIndexPage = {
      ...manifest,
      pages: [
        ...manifest.pages,
        {
          ...manifest.pages[0],
          title: "Docs home",
          urlPath: "/docs",
          absoluteUrl: "https://example.com/docs",
          markdownUrlPath: "/docs/index.md",
          markdownAbsoluteUrl: "https://example.com/docs/index.md",
          relativePath: "index",
        },
      ],
    } as unknown as typeof manifest;

    const response = await createAgentMarkdownResponse({
      urlPath: "/docs/old-home.md",
      headers: {},
      manifest: manifestWithIndexPage,
      redirects: [{ from: "/docs/old-home", to: "/docs", status: 308 }],
      readMarkdownFile: () => null,
    });

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe(
      "https://example.com/docs/index.md"
    );
  });

  it("resolves localized redirect targets from locale manifests", async () => {
    const localizedPage = {
      ...manifest.pages[0],
      title: "指南",
      urlPath: "/docs/zh/guides",
      absoluteUrl: "https://example.com/docs/zh/guides",
      markdownUrlPath: "/docs/zh/guides/index.md",
      markdownAbsoluteUrl: "https://example.com/docs/zh/guides/index.md",
      markdownFilePath: "docs/zh/guides/index.md",
      relativePath: "zh/guides/index",
      locale: "zh",
    };
    const localizedManifest = {
      ...manifest,
      locale: "zh",
      pages: [localizedPage],
    };

    const response = await createAgentMarkdownResponse({
      urlPath: "/docs/zh/old-guides.md",
      headers: {},
      manifest,
      localizedManifests: { zh: localizedManifest },
      redirects: [
        {
          from: "/docs/zh/old-guides",
          to: "/docs/zh/guides",
          status: 308,
        },
      ],
      readMarkdownFile: () => null,
    });

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe(
      "https://example.com/docs/zh/guides/index.md"
    );

    const location = response?.headers.get("location");
    expect(location).not.toBeNull();
    let localizedMirrorTarget = "";
    const destinationResponse = await createAgentMarkdownResponse({
      urlPath: new URL(location ?? "https://example.com").pathname,
      headers: {},
      manifest,
      localizedManifests: { zh: localizedManifest },
      readMarkdownFile: (target) => {
        localizedMirrorTarget = target.filePath;
        return target.filePath === "docs/zh/guides/index.md"
          ? "# Localized guides\n"
          : null;
      },
    });

    expect(destinationResponse?.status).toBe(200);
    expect(localizedMirrorTarget).toBe("docs/zh/guides/index.md");
    expect(await destinationResponse?.text()).toContain("# Localized guides");
  });

  it("ignores stale current-locale manifests when resolving redirects", async () => {
    const stalePage = {
      ...manifest.pages[0],
      title: "Stale guide",
      urlPath: "/docs/guides",
      absoluteUrl: "https://example.com/docs/guides",
      markdownUrlPath: "/docs/guides/index.md",
      markdownAbsoluteUrl: "https://example.com/docs/guides/index.md",
      markdownFilePath: "docs/guides/index.md",
      relativePath: "guides/index",
      locale: undefined,
    };
    const currentLocaleManifest = {
      ...manifest,
      locale: "fr",
      pages: [stalePage],
    };

    const response = await createAgentMarkdownResponse({
      urlPath: "/docs/old-guides.md",
      headers: {},
      manifest: { ...manifest, locale: "en" },
      localizedManifests: { en: currentLocaleManifest },
      redirects: [
        { from: "/docs/old-guides", to: "/docs/guides", status: 308 },
      ],
      readMarkdownFile: () => null,
    });

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe(
      "https://example.com/docs/guides.md"
    );
  });

  it("HEAD method returns headers with empty body", async () => {
    const response = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart",
      method: "HEAD",
      headers: { accept: "text/markdown" },
      manifest,
      readMarkdownFile: () => "---\ntitle: Quickstart\n---\n# Quickstart\n",
    });
    expect(response?.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(await response?.text()).toBe("");
  });

  it("rejects non-readable methods", async () => {
    const response = await createAgentMarkdownResponse({
      urlPath: "/docs/quickstart",
      method: "POST",
      headers: { accept: "text/markdown" },
      manifest,
      readMarkdownFile: () => "# x",
    });
    expect(response).toBeNull();
  });

  it("throws on unsupported manifest version", async () => {
    const badManifest = {
      ...manifest,
      version: 2,
    } as unknown as typeof manifest;
    await expect(
      createAgentMarkdownResponse({
        urlPath: "/docs/quickstart",
        headers: { accept: "text/markdown" },
        manifest: badManifest,
        readMarkdownFile: () => "# x",
      })
    ).rejects.toThrow(/manifest version 2/);
  });

  it("recognizes generated artifacts instead of treating them as missing pages", async () => {
    expect(isAgentReadabilityArtifactPath("/llms-full.txt")).toBe(true);
    expect(isAgentReadabilityArtifactPath("/.well-known/agent-card.json")).toBe(
      true
    );
    expect(
      isAgentReadabilityArtifactPath("/.well-known/agent-skills/index.json")
    ).toBe(true);
    expect(
      isAgentReadabilityArtifactPath(
        "/.well-known/agent-skills/leadtype-docs/SKILL.md"
      )
    ).toBe(true);
    expect(isAgentReadabilityArtifactPath("/docs/llms-full.txt")).toBe(false);
    expect(
      isAgentReadabilityArtifactPath("/docs/llms-full/get-started.txt")
    ).toBe(false);

    const localizedArtifactManifest = {
      ...manifest,
      i18n: {
        version: 1 as const,
        defaultLocale: "en",
        locales: [{ code: "en" }, { code: "zh" }],
        artifacts: [
          {
            locale: "zh",
            urlPrefix: "/docs/zh",
            sitemapMd: "/docs/zh/sitemap.md",
            sitemapXml: "/docs/zh/sitemap.xml",
          },
        ],
      },
    };
    expect(isAgentReadabilityArtifactPath("/docs/zh/sitemap.md")).toBe(false);
    expect(
      isAgentReadabilityArtifactPath(
        "/docs/zh/sitemap.md",
        localizedArtifactManifest
      )
    ).toBe(true);

    for (const urlPath of [
      "/.well-known/agent-card.json",
      "/.well-known/agent-skills/index.json",
      "/.well-known/agent-skills/leadtype-docs/SKILL.md",
    ]) {
      const response = await createAgentMarkdownResponse({
        urlPath,
        headers: { accept: "text/markdown" },
        manifest,
        readMarkdownFile: () => {
          throw new Error("generated artifacts must fall through");
        },
      });
      expect(response).toBeNull();
    }

    for (const urlPath of ["/docs/zh/sitemap.md", "/docs/zh/sitemap.xml"]) {
      const response = await createAgentMarkdownResponse({
        urlPath,
        headers: { accept: "text/markdown" },
        manifest: localizedArtifactManifest,
        readMarkdownFile: () => {
          throw new Error("localized artifacts must fall through");
        },
      });
      expect(response).toBeNull();
    }
  });

  it("enrichMarkdownFrontmatter tolerates CRLF line endings", () => {
    const markdown =
      "---\r\ntitle: Quickstart\r\nlastModified: 2026-05-01T12:00:00.000Z\r\n---\r\n# Quickstart\r\n";
    expect(
      enrichMarkdownFrontmatter(markdown, {
        canonicalUrl: "https://example.com/docs/quickstart",
      })
    ).toContain('last_updated: "2026-05-01T12:00:00.000Z"');
  });
});

describe("agent artifact response helpers", () => {
  const manifest = {
    version: 1,
    generatedAt: "2026-05-01T00:00:00.000Z",
    baseUrl: "https://leadtype.dev",
    product: { name: "Leadtype", summary: "Docs pipeline." },
    files: {
      robotsTxt: "/robots.txt",
      sitemapMd: "/sitemap.md",
      sitemapXml: "/sitemap.xml",
    },
    navigation: {
      groups: [
        {
          slug: "get-started",
          segmentPath: ["get-started"],
          title: "Get Started",
          description: "Start here.",
          pages: [
            {
              urlPath: "/docs/quickstart",
              title: "Quickstart",
              description: "Install.",
              groups: ["get-started"],
            },
          ],
          children: [],
        },
      ],
      ungrouped: [],
      unknown: [],
    },
    pages: [
      {
        title: "Quickstart",
        description: "Install.",
        urlPath: "/docs/quickstart",
        absoluteUrl: "https://leadtype.dev/docs/quickstart",
        markdownUrlPath: "/docs/quickstart.md",
        markdownAbsoluteUrl: "https://leadtype.dev/docs/quickstart.md",
        relativePath: "quickstart",
        groups: ["get-started"],
        lastModified: "2026-05-01T12:00:00.000Z",
      },
    ],
  } as const;

  it("createSitemapXmlResponse rebases absolute URLs against requestOrigin", async () => {
    const response = createSitemapXmlResponse({
      manifest,
      requestOrigin: "http://localhost:5173",
    });
    expect(response.headers.get("Content-Type")).toBe(
      "application/xml; charset=utf-8"
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, must-revalidate"
    );
    const body = await response.text();
    expect(body).toContain("<loc>http://localhost:5173/docs/quickstart</loc>");
    expect(body).not.toContain("https://leadtype.dev");
  });

  it("createSitemapXmlResponse falls back to manifest.baseUrl", async () => {
    const response = createSitemapXmlResponse({ manifest });
    const body = await response.text();
    expect(body).toContain("<loc>https://leadtype.dev/docs/quickstart</loc>");
  });

  it("createSitemapXmlResponse accepts merged pages", async () => {
    const response = createSitemapXmlResponse({
      manifest,
      requestOrigin: "https://example.com",
      pages: [
        ...manifest.pages,
        {
          title: "Marketing",
          description: "",
          urlPath: "/about",
          absoluteUrl: "https://leadtype.dev/about",
          markdownUrlPath: "/about.md",
          markdownAbsoluteUrl: "https://leadtype.dev/about.md",
          relativePath: "about",
          groups: [],
          lastModified: "2026-05-01T00:00:00.000Z",
        },
      ],
    });
    const body = await response.text();
    expect(body).toContain("<loc>https://example.com/about</loc>");
    expect(body).toContain("<loc>https://example.com/docs/quickstart</loc>");
  });

  it("createSitemapMarkdownResponse rebuilds the navigation tree", async () => {
    const response = createSitemapMarkdownResponse({
      manifest,
      requestOrigin: "http://localhost:5173",
    });
    expect(response.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8"
    );
    const body = await response.text();
    expect(body).toContain("# Sitemap");
    expect(body).toContain("## Get Started");
    expect(body).toContain("[Quickstart](/docs/quickstart)");
  });

  it("createRobotsTxtResponse uses live origin for Sitemap directive", async () => {
    const response = createRobotsTxtResponse({
      manifest,
      requestOrigin: "http://localhost:5173",
    });
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    );
    const body = await response.text();
    expect(body).toContain("Sitemap: http://localhost:5173/sitemap.xml");
    expect(body).toContain("User-agent: AmazonBot");
    expect(body).toContain("User-agent: Amazonbot");
    expect(body).toContain("User-agent: Bytespider");
    expect(body).toContain("User-agent: Applebot-Extended");
    expect(body).toContain("User-agent: Bingbot");
  });

  it("keeps root crawler artifacts at the request origin", async () => {
    const fromBase = "https://preview.example/product";
    const prefixedManifest = {
      ...manifest,
      baseUrl: `${fromBase}/`,
      pages: manifest.pages.map((page) => ({
        ...page,
        absoluteUrl: page.absoluteUrl.replace("https://leadtype.dev", fromBase),
        markdownAbsoluteUrl: page.markdownAbsoluteUrl.replace(
          "https://leadtype.dev",
          fromBase
        ),
      })),
    };
    const requestOrigin = "https://docs.example";
    const robots = await createRobotsTxtResponse({
      manifest: prefixedManifest,
      requestOrigin,
      schemamapUrlPath: "/schema-map.xml",
    }).text();
    expect(robots).toContain("Sitemap: https://docs.example/sitemap.xml");
    expect(robots).toContain("Schemamap: https://docs.example/schema-map.xml");
    expect(robots).not.toContain("https://docs.example/product/");

    const sitemap = await createSitemapXmlResponse({
      manifest: prefixedManifest,
      requestOrigin,
    }).text();
    expect(sitemap).toContain(
      "<loc>https://docs.example/product/docs/quickstart</loc>"
    );
  });

  it("uses the request origin when the manifest base URL is not absolute", async () => {
    const invalidBaseManifest = {
      ...manifest,
      baseUrl: "acme.dev",
      files: {
        ...manifest.files,
        apiCatalog: "/.well-known/api-catalog",
      },
      apis: [{ href: "/ask" }],
      pages: manifest.pages.map((page) => ({
        ...page,
        absoluteUrl: `acme.dev${page.urlPath}`,
        markdownAbsoluteUrl: `acme.dev${page.markdownUrlPath}`,
      })),
    };
    const requestOrigin = "https://staging.acme.dev";

    const sitemapXml = await createSitemapXmlResponse({
      manifest: invalidBaseManifest,
      requestOrigin,
    }).text();
    expect(sitemapXml).toContain(
      "<loc>https://staging.acme.dev/docs/quickstart</loc>"
    );
    expect(
      createSitemapMarkdownResponse({
        manifest: invalidBaseManifest,
        requestOrigin,
      }).status
    ).toBe(200);
    const robots = await createRobotsTxtResponse({
      manifest: invalidBaseManifest,
      requestOrigin,
    }).text();
    expect(robots).toContain("Sitemap: https://staging.acme.dev/sitemap.xml");
    const catalog = createApiCatalogResponse({
      manifest: invalidBaseManifest,
      requestOrigin,
    });
    expect(catalog).not.toBeNull();
    expect(await catalog?.text()).toContain("https://staging.acme.dev/ask");
  });

  it("Cache-Control: null strips the header on artifact responses", () => {
    const sitemap = createSitemapXmlResponse({ manifest, cacheControl: null });
    expect(sitemap.headers.get("Cache-Control")).toBeNull();
    const robots = createRobotsTxtResponse({ manifest, cacheControl: null });
    expect(robots.headers.get("Cache-Control")).toBeNull();
  });

  it("artifact responses throw on unsupported manifest version", () => {
    const bad = { ...manifest, version: 2 } as unknown as typeof manifest;
    expect(() => createSitemapXmlResponse({ manifest: bad })).toThrow(
      /manifest version 2/
    );
    expect(() => createSitemapMarkdownResponse({ manifest: bad })).toThrow();
    expect(() => createRobotsTxtResponse({ manifest: bad })).toThrow();
  });
});

describe("createDocsHead", () => {
  const manifest = {
    version: 1,
    generatedAt: "2026-05-01T00:00:00.000Z",
    baseUrl: "https://leadtype.dev",
    product: { name: "Leadtype", summary: "Docs pipeline." },
    files: {
      robotsTxt: "/robots.txt",
      sitemapMd: "/sitemap.md",
      sitemapXml: "/sitemap.xml",
    },
    navigation: { groups: [], ungrouped: [], unknown: [] },
    pages: [
      {
        title: "Quickstart",
        description: "Install.",
        urlPath: "/docs/quickstart",
        absoluteUrl: "https://leadtype.dev/docs/quickstart",
        markdownUrlPath: "/docs/quickstart.md",
        markdownAbsoluteUrl: "https://leadtype.dev/docs/quickstart.md",
        relativePath: "quickstart",
        groups: ["get-started"],
        lastModified: "2026-05-01T12:00:00.000Z",
      },
    ],
  } as const;

  it("returns title, og, json-ld meta + canonical and alternate links for known pages", () => {
    const head = createDocsHead({ urlPath: "/docs/quickstart", manifest });
    expect(head.meta).toContainEqual({ title: "Quickstart | Leadtype" });
    expect(head.meta).toContainEqual({
      name: "description",
      content: "Install.",
    });
    expect(head.meta).toContainEqual({
      property: "og:title",
      content: "Quickstart | Leadtype",
    });
    const jsonLdEntry = head.meta.find((m) => "script:ld+json" in m);
    expect(jsonLdEntry).toBeDefined();
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://leadtype.dev/docs/quickstart",
    });
    expect(head.links).toContainEqual({
      rel: "alternate",
      type: "text/markdown",
      href: "https://leadtype.dev/docs/quickstart.md",
    });
  });

  it("emits SEO meta (og:type, twitter:card always; image/keywords when set)", () => {
    // No seo configured: still emits og:type + a summary twitter:card.
    const bare = createDocsHead({ urlPath: "/docs/quickstart", manifest });
    expect(bare.meta).toContainEqual({
      property: "og:type",
      content: "article",
    });
    expect(bare.meta).toContainEqual({
      name: "twitter:card",
      content: "summary",
    });
    expect(bare.meta.some((m) => m.property === "og:image")).toBe(false);

    // Site-level seo (manifest) + per-page override (config.seo), config wins.
    const withSeo = createDocsHead({
      urlPath: "/docs/quickstart",
      manifest: { ...manifest, seo: { keywords: ["docs"], twitterSite: "@x" } },
      seo: { ogImage: "https://leadtype.dev/og/quickstart.png" },
    });
    expect(withSeo.meta).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
    expect(withSeo.meta).toContainEqual({
      property: "og:image",
      content: "https://leadtype.dev/og/quickstart.png",
    });
    expect(withSeo.meta).toContainEqual({
      name: "keywords",
      content: "docs",
    });
    expect(withSeo.meta).toContainEqual({
      name: "twitter:site",
      content: "@x",
    });
  });

  it("respects jsonLdMetaKey override", () => {
    const head = createDocsHead({
      urlPath: "/docs/quickstart",
      manifest,
      jsonLdMetaKey: "ldJson",
    });
    expect(head.meta.find((m) => "ldJson" in m)).toBeDefined();
    expect(head.meta.find((m) => "script:ld+json" in m)).toBeUndefined();
  });

  it("passes JSON-LD overrides through the head helper", () => {
    const head = createDocsHead({
      urlPath: "/docs/quickstart",
      manifest,
      jsonLd: {
        overrides: {
          author: { "@type": "Person", name: "Docs Team" },
          breadcrumb: false,
        },
      },
    });
    const jsonLdEntry = head.meta.find((m) => "script:ld+json" in m) as
      | { "script:ld+json"?: Record<string, unknown> }
      | undefined;

    expect(jsonLdEntry?.["script:ld+json"]).toMatchObject({
      author: { "@type": "Person", name: "Docs Team" },
    });
    expect(jsonLdEntry?.["script:ld+json"]).not.toHaveProperty("breadcrumb");
  });

  it("returns empty arrays for unknown urlPath", () => {
    const head = createDocsHead({ urlPath: "/docs/unknown", manifest });
    expect(head.meta).toEqual([]);
    expect(head.links).toEqual([]);
  });

  it("throws on unsupported manifest version", () => {
    const bad = { ...manifest, version: 2 } as unknown as typeof manifest;
    expect(() =>
      createDocsHead({ urlPath: "/docs/quickstart", manifest: bad })
    ).toThrow(/manifest version 2/);
  });
});

describe("extractDocsTableOfContents", () => {
  it("extracts nested h2/h3 entries and ignores frontmatter and code fences", () => {
    const toc = extractDocsTableOfContents(
      [
        "---",
        "title: Example",
        "---",
        "# Page title",
        "## Install [`leadtype`](/docs/quickstart)",
        "### Configure",
        "```md",
        "## Not a heading",
        "```",
        "~~~md",
        "## Not a tilde heading",
        "~~~",
        "#### Too deep",
        "## Café API: Quick Start!",
      ].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc).toEqual([
      {
        id: "install-leadtype",
        title: "Install leadtype",
        level: 2,
        urlPath: "/docs/example",
        urlWithHash: "/docs/example#install-leadtype",
        absoluteUrlWithHash:
          "https://leadtype.dev/docs/example#install-leadtype",
        children: [
          {
            id: "configure",
            title: "Configure",
            level: 3,
            urlPath: "/docs/example",
            urlWithHash: "/docs/example#configure",
            absoluteUrlWithHash: "https://leadtype.dev/docs/example#configure",
            children: [],
          },
        ],
      },
      {
        id: "cafe-api-quick-start",
        title: "Café API: Quick Start!",
        level: 2,
        urlPath: "/docs/example",
        urlWithHash: "/docs/example#cafe-api-quick-start",
        absoluteUrlWithHash:
          "https://leadtype.dev/docs/example#cafe-api-quick-start",
        children: [],
      },
    ]);
  });

  it("only closes a code fence with the matching marker type", () => {
    const toc = extractDocsTableOfContents(
      [
        "## Before",
        "```md",
        "## Hidden in backticks",
        "~~~",
        "## Still hidden",
        "```",
        "## After",
      ].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => item.title)).toEqual(["Before", "After"]);
  });

  it("does not close a code fence with a shorter matching marker", () => {
    const toc = extractDocsTableOfContents(
      [
        "## Before",
        "````md",
        "```",
        "## Still hidden",
        "````",
        "## After",
      ].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => item.title)).toEqual(["Before", "After"]);
  });

  it("deduplicates repeated heading anchors per page", () => {
    const toc = extractDocsTableOfContents(
      ["## Install", "### Install", "## Install"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc[0]).toMatchObject({
      id: "install",
      urlWithHash: "/docs/example#install",
      absoluteUrlWithHash: "https://leadtype.dev/docs/example#install",
    });
    expect(toc[0]?.children[0]).toMatchObject({
      id: "install-1",
      urlWithHash: "/docs/example#install-1",
      absoluteUrlWithHash: "https://leadtype.dev/docs/example#install-1",
    });
    expect(toc[1]).toMatchObject({
      id: "install-2",
      urlWithHash: "/docs/example#install-2",
      absoluteUrlWithHash: "https://leadtype.dev/docs/example#install-2",
    });
  });

  it("counts headings outside the level range when numbering anchors", () => {
    // The rendered page slugs every heading, so the h1 claims `install` and
    // the h2 below it renders as `install-1` — even though the default 2..3
    // range keeps the h1 out of the TOC itself.
    const toc = extractDocsTableOfContents(
      ["# Install", "## Install", "#### Setup", "### Setup"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc[0]).toMatchObject({
      id: "install-1",
      level: 2,
      urlWithHash: "/docs/example#install-1",
      absoluteUrlWithHash: "https://leadtype.dev/docs/example#install-1",
    });
    expect(toc[0]?.children[0]).toMatchObject({
      id: "setup-1",
      level: 3,
      urlWithHash: "/docs/example#setup-1",
    });
  });

  it("does not collide a later Foo-1 heading with a numbered duplicate", () => {
    const toc = extractDocsTableOfContents(
      ["## Foo", "## Foo", "## Foo-1"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => item.id)).toEqual(["foo", "foo-1", "foo-1-1"]);
  });

  it("still suffixes empty slugs the way the previous counter did", () => {
    const toc = extractDocsTableOfContents(["## !!!", "## !!!"].join("\n"), {
      urlPath: "/docs/example",
      absoluteUrl: "https://leadtype.dev/docs/example",
    });

    expect(toc.map((item) => item.id)).toEqual(["", "-1"]);
  });

  it("counts empty ATX headings when numbering later empty slugs", () => {
    const toc = extractDocsTableOfContents(["##", "## !!!"].join("\n"), {
      urlPath: "/docs/example",
      absoluteUrl: "https://leadtype.dev/docs/example",
    });

    expect(toc.map((item) => item.id)).toEqual(["-1"]);
  });

  it("counts Setext headings when numbering anchors", () => {
    const toc = extractDocsTableOfContents(
      ["Install", "=======", "## Install"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc).toHaveLength(1);
    expect(toc[0]).toMatchObject({
      id: "install-1",
      title: "Install",
      level: 2,
      urlWithHash: "/docs/example#install-1",
    });
  });

  it("includes in-range Setext headings and ignores underlined text in fences", () => {
    const toc = extractDocsTableOfContents(
      [
        "Setup",
        "------",
        "```md",
        "Hidden",
        "=======",
        "```",
        "## Configure",
      ].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "setup", title: "Setup" },
      { id: "configure", title: "Configure" },
    ]);
  });

  it("includes every paragraph line in a Setext heading", () => {
    const toc = extractDocsTableOfContents(
      ["First line", "second line", "---"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc).toEqual([
      {
        id: "first-line-second-line",
        title: "First line second line",
        level: 2,
        urlPath: "/docs/example",
        urlWithHash: "/docs/example#first-line-second-line",
        absoluteUrlWithHash:
          "https://leadtype.dev/docs/example#first-line-second-line",
        children: [],
      },
    ]);
  });

  it("does not treat a four-space-indented underline as Setext", () => {
    const toc = extractDocsTableOfContents(
      ["Install", "    ---", "## Install"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "install", title: "Install" },
    ]);
  });

  it("allows a Setext underline to use three spaces and CRLF", () => {
    const toc = extractDocsTableOfContents(
      ["Install", "   ---", "## Install"].join("\r\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "install", title: "Install" },
      { id: "install-1", title: "Install" },
    ]);
  });

  it("allows inline HTML at the start of Setext heading text", () => {
    const fixtures = [
      {
        heading: '<em title="1 > 0">Install</em>',
        title: "Install",
      },
      { heading: "Install <!-- don't -->", title: "Install" },
      { heading: "<hgroup>Note</hgroup>", title: "Note" },
    ];

    for (const { heading, title } of fixtures) {
      const toc = extractDocsTableOfContents(
        [heading, "---", `## ${title}`].join("\n"),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      const id = title.toLowerCase();
      expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
        { id, title },
        { id: `${id}-1`, title },
      ]);
    }
  });

  it("keeps a trailing marker wrapped in inline HTML in the heading title", () => {
    const toc = extractDocsTableOfContents("## Anchors and <code>#</code>", {
      urlPath: "/docs/example",
      absoluteUrl: "https://leadtype.dev/docs/example",
    });

    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "anchors-and", title: "Anchors and #" },
    ]);
  });

  it("strips MDX JSX tags from ATX heading text", () => {
    for (const tag of [
      "<Icons.Install />",
      "<Icons:Install />",
      "<_Icon />",
      "<$Icon />",
      "<My_Icon />",
      "<My$Icon />",
    ]) {
      const toc = extractDocsTableOfContents(
        [`## ${tag} Install`, "## Install"].join("\n"),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
        { id: "install", title: "Install" },
        { id: "install-1", title: "Install" },
      ]);
    }
  });

  it("preserves malformed MDX JSX names in heading text", () => {
    for (const { id, tag } of [
      { id: "9icon-install", tag: "<9Icon />" },
      { id: "my-icon-install", tag: "<My..Icon />" },
      { id: "my-icon-part-install", tag: "<My:Icon:Part />" },
    ]) {
      const toc = extractDocsTableOfContents(`## ${tag} Install`, {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      });

      expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
        { id, title: `${tag} Install` },
      ]);
    }
  });

  it("handles balanced MDX expression attributes in flow and heading text", () => {
    for (const tag of [
      "<span value={1 > 0}>",
      "<span value={{ nested: 1 > 0 }}>",
    ]) {
      const toc = extractDocsTableOfContents(
        [tag, "---", "</span>", "## 0"].join("\n"),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => item.id)).toEqual(["0"]);
    }

    const toc = extractDocsTableOfContents(
      ["## <span value={1 > 0}>Install</span>", "## Install"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );
    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "install", title: "Install" },
      { id: "install-1", title: "Install" },
    ]);
  });

  it("parses JavaScript literals in MDX expression attributes", () => {
    for (const lineEnding of ["\n", "\r\n"]) {
      const toc = extractDocsTableOfContents(
        [
          "<span value={/* don't > */ 1 > 0}>",
          "---",
          "</span>",
          "<span value={10 / 2 > 0}>",
          "---",
          "</span>",
          "## <Badge pattern={/don't/} /> Install",
          "## <Badge onClick={() => { if (ready) {} /don't/.test(value); }} /> Install",
          "## <Badge onClick={() => { if (ready) /don't/.test(value); }} /> Install",
          "## <Badge onClick={() => { while (ready) /don't/.test(value); }} /> Install",
          `## <Badge value={\`outer \${\`don't\`}\`} /> Install`,
          "## <Badge value={{} / 2 > 0} /> Install",
          "## <Badge value={compute() / 2 > 0} /> Install",
          "## Install",
        ].join(lineEnding),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
        { id: "install", title: "Install" },
        { id: "install-1", title: "Install" },
        { id: "install-2", title: "Install" },
        { id: "install-3", title: "Install" },
        { id: "install-4", title: "Install" },
        { id: "install-5", title: "Install" },
        { id: "install-6", title: "Install" },
        { id: "install-7", title: "Install" },
      ]);
    }
  });

  it("distinguishes regex statements from division around JavaScript bodies", () => {
    const toc = extractDocsTableOfContents(
      [
        "## <Badge onClick={() => { if (ready) foo(); else /don't/.test(value); }} /> Install",
        "## <Badge onClick={() => { do /don't/.test(value); while (ready); }} /> Install",
        "## <Badge value={(function named() {}) / 'x > y'} /> Install",
        "## Install",
      ].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "install", title: "Install" },
      { id: "install-1", title: "Install" },
      { id: "install-2", title: "Install" },
      { id: "install-3", title: "Install" },
    ]);
  });

  it("tracks JavaScript block context without rescanning literal braces", () => {
    const tags = [
      `<Badge onClick={() => { if (ready) { const marker = "}"; } /don't/.test(value); }} />`,
      `<Badge onClick={() => { if (ready) { /* } { */ } /don't/.test(value); }} />`,
      "<Badge onClick={() => { if (ready) { const marker = `}`; } /don't/.test(value); }} />",
      `<Badge onClick={() => { if (ready) { const marker = /[{}]/; } /don't/.test(value); }} />`,
      `<Badge onClick={() => { function helper() {} /don't/.test(value); }} />`,
      `<Badge onClick={() => { class Helper {} /don't/.test(value); }} />`,
      `<Badge value={(function named() {}) / "x > y"} />`,
      `<Badge value={(class Named {}) / "x > y"} />`,
      `<Badge value={obj.if() / "x > y"} />`,
      `<Badge onClick={async () => { for await (const item of values) /don't/.test(item); }} />`,
    ];

    for (const tag of tags) {
      const toc = extractDocsTableOfContents(
        [`## ${tag} Install`, "## Install"].join("\n"),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
        { id: "install", title: "Install" },
        { id: "install-1", title: "Install" },
      ]);
    }
  });

  it("stacks declaration contexts and recognizes statement colons", () => {
    const tags = [
      `<Badge onClick={() => { function helper(callback = function nested() {}) {} /don't/.test(value); }} />`,
      `<Badge onClick={() => { class Outer extends (class Inner {}) {} /don't/.test(value); }} />`,
      `<Badge onClick={() => { label: {} /don't/.test(value); }} />`,
      `<Badge onClick={() => { switch (value) { case 1: {} /don't/.test(value); } }} />`,
      `<Badge onClick={() => { switch (value) { case ready ? one : two: {} /don't/.test(value); } }} />`,
      `<Badge onClick={() => { switch (value) { case (() => { switch (inner) { case 1: return 2; } return 3; })(): {} /don't/.test(value); } }} />`,
      `<Badge value={(function outer(callback = function nested() {}) {}) / "x > y"} />`,
      `<Badge value={(class Outer extends (class Inner {}) {}) / "x > y"} />`,
      `<Badge value={{ value: {} / "x > y" }} />`,
    ];

    for (const tag of tags) {
      const toc = extractDocsTableOfContents(
        [`## ${tag} Install`, "## Install"].join("\n"),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
        { id: "install", title: "Install" },
        { id: "install-1", title: "Install" },
      ]);
    }
  });

  it("distinguishes postfix updates from prefix and binary operators", () => {
    const tags = [
      "<Badge value={x++ / 2} />",
      "<Badge value={x-- / 2} />",
      `<Badge value={x++ / /don't/.test(value)} />`,
      "<Badge value={++x / 2} />",
      "<Badge value={--x / 2} />",
      `<Badge value={x + /don't/.test(value)} />`,
      `<Badge value={x - /don't/.test(value)} />`,
    ];

    for (const tag of tags) {
      const toc = extractDocsTableOfContents(
        [`## ${tag} Install`, "## Install"].join("\n"),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
        { id: "install", title: "Install" },
        { id: "install-1", title: "Install" },
      ]);
    }
  });

  it("recognizes Unicode identifiers and spread operands", () => {
    const tags = [
      '<Badge value={value / "x > y"} />',
      '<Badge value={π / "x > y"} />',
      '<Badge value={a\u200Cb / "x > y"} />',
      '<Badge value={a\u200Db / "x > y"} />',
      '<Badge value={\u{10400} / "x > y"} />',
      '<Badge value={π.value / "x > y"} />',
      '<Badge value={π?.value / "x > y"} />',
      `<Badge value={{ .../don't/ }} />`,
      '<Badge value={{ ...value / "x > y" }} />',
    ];

    for (const tag of tags) {
      const toc = extractDocsTableOfContents(
        [`## ${tag} Install`, "## Install"].join("\n"),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
        { id: "install", title: "Install" },
        { id: "install-1", title: "Install" },
      ]);
    }
  });

  it("recognizes regex operands in class heritage", () => {
    const tags = [
      `<Badge value={class extends /don't/.constructor {}} />`,
      `<Badge value={class Named extends /don't/.constructor {}} />`,
      '<Badge value={class extends (Base / "x > y") {}} />',
      '<Badge value={class Named extends (Base / "x > y") {}} />',
      '<Badge value={(class {}) / "x > y"} />',
      '<Badge value={(class Named {}) / "x > y"} />',
      '<Badge value={obj.extends / "x > y"} />',
      `<Badge onClick={() => { class Named {} /don't/.test(value); }} />`,
    ];

    for (const tag of tags) {
      const toc = extractDocsTableOfContents(
        [`## ${tag} Install`, "## Install"].join("\n"),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
        { id: "install", title: "Install" },
        { id: "install-1", title: "Install" },
      ]);
    }
  });

  it("does not treat a thematic break after a blank line as a Setext heading", () => {
    const toc = extractDocsTableOfContents(
      ["A paragraph.", "", "---", "## After"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => item.title)).toEqual(["After"]);
  });

  it("does not treat block constructs before a thematic break as Setext headings", () => {
    const blockConstructs = [
      "> Note",
      "- Note",
      "    Note",
      "<aside>Note</aside>",
      "<span>",
      "<Callout>Note</Callout>",
      "{note}",
      "[note]: /docs/note",
      "* * *",
      "---",
    ];

    for (const blockConstruct of blockConstructs) {
      const toc = extractDocsTableOfContents(
        [blockConstruct, "---", "## Note"].join("\n"),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => item.id)).toEqual(["note"]);
    }
  });

  it("recognizes lowercase MDX member-expression flow tags", () => {
    const toc = extractDocsTableOfContents(
      [
        "<components.Note>",
        "---",
        "</components.Note>",
        "## Components Note",
      ].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => item.id)).toEqual(["components-note"]);
  });

  it("recognizes MDX fragments in flow and ATX heading text", () => {
    const toc = extractDocsTableOfContents(
      ["<>", "Install", "</>", "---", "## <>Install</>", "## Install"].join(
        "\n"
      ),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "install", title: "Install" },
      { id: "install-1", title: "Install" },
    ]);
  });

  it("keeps a one-line MDX fragment as Setext heading text", () => {
    const toc = extractDocsTableOfContents(
      ["<>Install</>", "---", "## Install"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "install", title: "Install" },
      { id: "install-1", title: "Install" },
    ]);
  });

  it("recognizes bare block starters for LF and CRLF", () => {
    for (const blockStart of ["<pre", "<div", "<Callout"]) {
      for (const lineEnding of ["\n", "\r\n"]) {
        const toc = extractDocsTableOfContents(
          ["Title", blockStart, "---", "## After"].join(lineEnding),
          {
            urlPath: "/docs/example",
            absoluteUrl: "https://leadtype.dev/docs/example",
          }
        );

        expect(toc.map((item) => item.id)).toEqual(["after"]);
      }
    }
  });

  it("recognizes standalone HTML tags with quoted delimiters for LF and CRLF", () => {
    for (const lineEnding of ["\n", "\r\n"]) {
      const toc = extractDocsTableOfContents(
        ['<span title="1 < 2 > 0">', "---", "</span>", "## !!!", "## !!!"].join(
          lineEnding
        ),
        {
          urlPath: "/docs/example",
          absoluteUrl: "https://leadtype.dev/docs/example",
        }
      );

      expect(toc.map((item) => item.id)).toEqual(["", "-1"]);
    }
  });

  it("preserves comparisons and strips declarations from heading text", () => {
    const toc = extractDocsTableOfContents(
      [
        "## 1 < 2 > 0",
        "## Install <?don't?>",
        "## Install <!THING don't>",
        "## Install",
      ].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "1-2-0", title: "1 < 2 > 0" },
      { id: "install", title: "Install" },
      { id: "install-1", title: "Install" },
      { id: "install-2", title: "Install" },
    ]);
  });

  it("strips CDATA and preserves unterminated HTML constructs", () => {
    const toc = extractDocsTableOfContents(
      ["## Install <![CDATA[x]]>", '## Install <em title="x'].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      }
    );

    expect(toc.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: "install", title: "Install" },
      { id: "install-em-title-x", title: 'Install <em title="x' },
    ]);
  });

  it("respects custom heading level ranges", () => {
    const toc = extractDocsTableOfContents(
      ["# Page", "## Section", "### Child", "#### Detail"].join("\n"),
      {
        urlPath: "/docs/example",
        absoluteUrl: "https://leadtype.dev/docs/example",
      },
      { minLevel: 3, maxLevel: 4 }
    );

    expect(toc.map((item) => item.title)).toEqual(["Child"]);
    expect(toc[0]?.children.map((item) => item.title)).toEqual(["Detail"]);
  });
});

describe("defineFrameworkNavigation", () => {
  it("expands framework templates into plain navigation nodes", () => {
    const nav = defineFrameworkNavigation({
      title: "Frameworks",
      base: "frameworks",
      pages: ["index"],
      templates: {
        componentFramework: {
          pages: ["quickstart", "optimization", "/ai-agents"],
          children: [
            {
              title: "Concepts",
              pages: ["consent-management", "consent-banner"],
            },
            {
              title: "Guides",
              pages: ["script-loader", "iframe-blocking"],
            },
          ],
        },
      },
      frameworks: [
        { title: "React", base: "react", template: "componentFramework" },
        { title: "Next.js", base: "next", template: "componentFramework" },
        {
          title: "JavaScript",
          base: "javascript",
          pages: ["quickstart", "optimization", "/ai-agents"],
          children: [
            {
              title: "Guides",
              pages: ["script-loader", "network-blocker"],
            },
          ],
        },
      ],
    });

    expect(nav).toEqual({
      title: "Frameworks",
      base: "frameworks",
      pages: ["index"],
      children: [
        {
          title: "React",
          base: "react",
          pages: ["quickstart", "optimization", "/ai-agents"],
          children: [
            {
              title: "Concepts",
              pages: ["consent-management", "consent-banner"],
            },
            {
              title: "Guides",
              pages: ["script-loader", "iframe-blocking"],
            },
          ],
        },
        {
          title: "Next.js",
          base: "next",
          pages: ["quickstart", "optimization", "/ai-agents"],
          children: [
            {
              title: "Concepts",
              pages: ["consent-management", "consent-banner"],
            },
            {
              title: "Guides",
              pages: ["script-loader", "iframe-blocking"],
            },
          ],
        },
        {
          title: "JavaScript",
          base: "javascript",
          pages: ["quickstart", "optimization", "/ai-agents"],
          children: [
            {
              title: "Guides",
              pages: ["script-loader", "network-blocker"],
            },
          ],
        },
      ],
    });
  });

  it("throws when a framework references an unknown template", () => {
    expect(() =>
      defineFrameworkNavigation({
        title: "Frameworks",
        base: "frameworks",
        frameworks: [{ title: "React", base: "react", template: "missing" }],
      })
    ).toThrow(
      'defineFrameworkNavigation: unknown template "missing" for framework "React"'
    );
  });
});

describe("resolveDocsNavigation", () => {
  it("resolves root page entries as top-level navigation pages", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "index.mdx",
        frontmatter: "title: Home\ndescription: Overview.",
      },
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start.",
      },
      {
        relativePath: "guides/index.mdx",
        frontmatter: "title: Guides\ndescription: Guide overview.",
      },
    ]);

    const nav = await resolveDocsNavigation({
      srcDir: projectDir,
      nav: [
        "index",
        "quickstart",
        { title: "Guides", base: "guides", pages: ["index"] },
      ],
    });

    expect(nav.ungrouped.map((page) => page.urlPath)).toEqual([
      "/docs",
      "/docs/quickstart",
    ]);
    expect(nav.groups[0]?.pages.map((page) => page.urlPath)).toEqual([
      "/docs/guides",
    ]);
  });

  it("resolves curated nav with inherited base, includes, and root-relative refs", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "ai-agents.mdx",
        frontmatter: "title: AI Agents\ndescription: Agent setup.",
      },
      {
        relativePath: "frameworks/next/quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start.",
      },
      {
        relativePath: "frameworks/next/concepts/client-modes.mdx",
        frontmatter: "title: Client Modes\ndescription: Modes.\norder: 20",
      },
      {
        relativePath: "frameworks/next/concepts/initialization-flow.mdx",
        frontmatter:
          "title: Initialization Flow\ndescription: Flow.\norder: 10",
      },
      {
        relativePath: "frameworks/next/concepts/glossary.mdx",
        frontmatter: "title: Glossary\ndescription: Terms.",
      },
    ]);

    const nav = await resolveDocsNavigation({
      srcDir: projectDir,
      baseUrl: "https://c15t.com",
      nav: [
        {
          title: "Frameworks",
          children: [
            {
              title: "Next.js",
              base: "frameworks/next",
              children: [
                {
                  title: "Start",
                  pages: ["quickstart", "/ai-agents"],
                },
                {
                  title: "Concepts",
                  pages: [
                    "concepts/client-modes",
                    { include: "concepts/*", sort: ["order", "path"] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const next = nav.groups[0]?.children[0];
    const start = next?.children[0];
    const concepts = next?.children[1];

    expect(nav.groups[0]?.slug).toBe("frameworks");
    expect(next?.slug).toBe("next-js");
    expect(start?.pages.map((page) => page.urlPath)).toEqual([
      "/docs/frameworks/next/quickstart",
      "/docs/ai-agents",
    ]);
    expect(concepts?.pages.map((page) => page.title)).toEqual([
      "Client Modes",
      "Initialization Flow",
      "Glossary",
    ]);
    expect(nav.ungrouped).toHaveLength(0);
  });

  it("keeps shared pages in every nav branch that references them", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "ai-agents.mdx",
        frontmatter: "title: AI Agents\ndescription: Agent setup.",
      },
      {
        relativePath: "frameworks/next/quickstart.mdx",
        frontmatter: "title: Next Quickstart\ndescription: Start.",
      },
      {
        relativePath: "frameworks/react/quickstart.mdx",
        frontmatter: "title: React Quickstart\ndescription: Start.",
      },
    ]);

    const nav = await resolveDocsNavigation({
      srcDir: projectDir,
      nav: [
        {
          title: "Frameworks",
          children: [
            {
              title: "Next.js",
              base: "frameworks/next",
              pages: ["quickstart", "/ai-agents"],
            },
            {
              title: "React",
              base: "frameworks/react",
              pages: ["quickstart", "/ai-agents"],
            },
          ],
        },
      ],
    });

    const next = nav.groups[0]?.children[0];
    const react = nav.groups[0]?.children[1];

    expect(next?.pages.map((page) => page.urlPath)).toEqual([
      "/docs/frameworks/next/quickstart",
      "/docs/ai-agents",
    ]);
    expect(react?.pages.map((page) => page.urlPath)).toEqual([
      "/docs/frameworks/react/quickstart",
      "/docs/ai-agents",
    ]);
    expect(nav.ungrouped).toHaveLength(0);
  });

  it("fails when an explicit nav page does not exist", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart",
      },
    ]);

    await expect(
      resolveDocsNavigation({
        srcDir: projectDir,
        nav: [{ title: "Start", pages: ["missing"] }],
      })
    ).rejects.toThrow(/Nav page "missing"/);
  });

  it("reports unknown legacy groups while using curated nav", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart\ngroup: mystery",
      },
    ]);

    const nav = await resolveDocsNavigation({
      srcDir: projectDir,
      nav: [{ title: "Start", pages: ["quickstart"] }],
      groups: [{ slug: "known", title: "Known" }],
    });

    expect(nav.groups[0]?.pages[0]?.title).toBe("Quickstart");
    expect(nav.unknown).toEqual([
      { urlPath: "/docs/quickstart", slug: "mystery" },
    ]);
  });

  it("returns the group tree, attached pages, and unknown-group references", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "frameworks/react.mdx",
        frontmatter: "title: React\ndescription: React.\ngroup: react",
        body: "## Install\n\n### Configure",
      },
      {
        relativePath: "frameworks/next.mdx",
        frontmatter: "title: Next.js\ndescription: Next.\ngroup: next",
      },
      {
        relativePath: "rate-limiting.mdx",
        frontmatter:
          "title: Rate Limit\ndescription: Shared.\ngroup:\n  - react\n  - mystery",
      },
      {
        relativePath: "ungrouped.mdx",
        frontmatter: "title: Ungrouped\ndescription: No group.",
      },
    ]);

    const nav = await resolveDocsNavigation({
      srcDir: projectDir,
      baseUrl: "https://c15t.com",
      groups: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Frameworks.",
          children: [
            { slug: "react", title: "React", description: "React." },
            { slug: "next", title: "Next.js", description: "Next.js." },
          ],
        },
      ],
    });

    expect(nav.groups).toHaveLength(1);
    expect(nav.groups[0]?.slug).toBe("frameworks");
    expect(nav.groups[0]?.children.map((c) => c.slug)).toEqual([
      "react",
      "next",
    ]);

    const reactPages = nav.groups[0]?.children[0]?.pages.map((p) => p.title);
    expect(reactPages).toContain("React");
    expect(reactPages).toContain("Rate Limit");
    const reactPage = nav.groups[0]?.children[0]?.pages.find(
      (page) => page.title === "React"
    );
    expect(reactPage?.toc[0]).toMatchObject({
      id: "install",
      title: "Install",
      urlWithHash: "/docs/frameworks/react#install",
    });
    expect(reactPage?.toc[0]?.children[0]).toMatchObject({
      id: "configure",
      title: "Configure",
    });

    const ungroupedTitles = nav.ungrouped.map((p) => p.title);
    expect(ungroupedTitles).toContain("Ungrouped");

    expect(nav.unknown).toContainEqual({
      urlPath: "/docs/rate-limiting",
      slug: "mystery",
    });
  });

  it("can disable TOC extraction while preserving page shape", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter:
          "title: Quickstart\ndescription: Start.\ngroup: get-started",
        body: "## Install",
      },
    ]);

    const nav = await resolveDocsNavigation({
      srcDir: projectDir,
      groups: [{ slug: "get-started", title: "Get Started" }],
      toc: false,
    });

    expect(nav.groups[0]?.pages[0]?.toc).toEqual([]);
  });

  it("matches literal nav entries in every locale, falling back to the default locale's pages", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "index.mdx",
        frontmatter: "title: Home\ndescription: Overview.",
      },
      {
        relativePath: "guides/setup.mdx",
        frontmatter: "title: Setup\ndescription: Setup.",
      },
      {
        relativePath: "zh/index.mdx",
        frontmatter: "title: 首页\ndescription: 概览。",
      },
    ]);

    const config = {
      srcDir: projectDir,
      i18n: { defaultLocale: "en", locales: ["en", "zh"] },
      nav: [
        "index",
        { title: "Guides", base: "guides", pages: ["setup"] },
      ] as DocsNavEntry[],
    };

    const en = await resolveDocsNavigation({ ...config, locale: "en" });
    expect(en.ungrouped.map((page) => page.urlPath)).toEqual(["/docs"]);
    expect(en.groups[0]?.pages.map((page) => page.urlPath)).toEqual([
      "/docs/guides/setup",
    ]);

    // A non-default locale's pages carry locale-prefixed output paths
    // ("zh/index"), but a nav entry names the locale-stripped logical path —
    // matching on the output path made every literal entry miss every
    // non-default locale, so every `navigation` + `i18n` project failed to
    // build. The untranslated guide resolves to the default locale's page
    // re-selected under `zh` — the fallback `fallback: "default"` promises.
    const zh = await resolveDocsNavigation({ ...config, locale: "zh" });
    expect(zh.ungrouped.map((page) => [page.urlPath, page.isFallback])).toEqual(
      [["/docs/zh", false]]
    );
    expect(
      zh.groups[0]?.pages.map((page) => [page.urlPath, page.isFallback])
    ).toEqual([["/docs/zh/guides/setup", true]]);
  });

  it("applies include, exclude, and pin entries against locale-stripped paths", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "guides/setup.mdx",
        frontmatter: "title: Setup\ndescription: Setup.",
      },
      {
        relativePath: "guides/advanced.mdx",
        frontmatter: "title: Advanced\ndescription: Advanced.",
      },
      {
        relativePath: "guides/draft.mdx",
        frontmatter: "title: Draft\ndescription: Draft.",
      },
      {
        relativePath: "zh/guides/advanced.mdx",
        frontmatter: "title: 进阶\ndescription: 进阶。",
      },
    ]);

    const nav = await resolveDocsNavigation({
      srcDir: projectDir,
      i18n: { defaultLocale: "en", locales: ["en", "zh"] },
      locale: "zh",
      nav: [
        {
          title: "Guides",
          base: "guides",
          pages: [{ include: "*", exclude: "draft", pin: "setup" }],
        },
      ],
    });

    // The include glob, the exclude, and the pin all name locale-stripped
    // paths: the pin leads with the fallback setup page, the translated
    // advanced page follows, and the excluded draft stays out — exactly the
    // default locale's shape, shifted under /docs/zh.
    expect(
      nav.groups[0]?.pages.map((page) => [page.urlPath, page.isFallback])
    ).toEqual([
      ["/docs/zh/guides/setup", true],
      ["/docs/zh/guides/advanced", false],
    ]);
  });
});

describe("resolveDocsTableOfContents", () => {
  it("returns TOC pages without requiring navigation groups", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "quickstart.mdx",
        frontmatter: "title: Quickstart\ndescription: Start.",
        body: "## Install\n\n## Run",
      },
    ]);

    const pages = await resolveDocsTableOfContents({
      srcDir: projectDir,
      baseUrl: "https://leadtype.dev",
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      title: "Quickstart",
      urlPath: "/docs/quickstart",
      toc: [
        {
          title: "Install",
          urlWithHash: "/docs/quickstart#install",
        },
        {
          title: "Run",
          urlWithHash: "/docs/quickstart#run",
        },
      ],
    });
  });
});
