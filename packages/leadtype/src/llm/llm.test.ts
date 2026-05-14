import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractDocsTableOfContents,
  generateAgentReadabilityArtifacts,
  generateLLMFullContextFiles,
  generateLlmsTxt,
  resolveDocsNavigation,
  resolveDocsTableOfContents,
} from "./llm";
import {
  acceptsMarkdownHeader,
  createAgentMarkdownResponse,
  createDocsHead,
  createMarkdownResponseHeaders,
  createRobotsTxtResponse,
  createSitemapMarkdownResponse,
  createSitemapXmlResponse,
  enrichMarkdownFrontmatter,
  isAgentReadabilityArtifactPath,
  isAgentUserAgent,
  renderJsonLd,
  renderJsonLdScript,
  renderMissingMarkdown,
  renderRobotsTxt,
  renderSitemapXml,
  resolveMarkdownMirrorTarget,
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

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://leadtype.dev",
      product: { name: "Leadtype", summary: "Docs pipeline." },
      groups: [{ slug: "get-started", title: "Get Started" }],
      i18n: { defaultLocale: "en", locales: ["en", "zh"] },
      locale: "zh",
    });

    const zhSummary = await readFile(
      path.join(outDir, "docs", "zh", "llms.txt"),
      "utf8"
    );
    expect(zhSummary).toContain("快速开始");
    expect(zhSummary).toContain("](/docs/zh/quickstart.md)");
    expect(zhSummary).not.toContain("Setup");
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
  it("emits docs-scoped sitemap, robots, and manifest files", async () => {
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

    expect(existsSync(path.join(projectDir, "docs", "sitemap.xml"))).toBe(true);
    expect(existsSync(path.join(projectDir, "docs", "sitemap.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "docs", "robots.txt"))).toBe(true);
    expect(
      existsSync(path.join(projectDir, "docs", "agent-readability.json"))
    ).toBe(true);

    const sitemapXml = await readFile(result.files.sitemapXml, "utf8");
    expect(sitemapXml).toContain("<urlset");
    expect(sitemapXml).toContain(
      "<loc>https://leadtype.dev/docs/quickstart</loc>"
    );
    expect(sitemapXml).toContain("<lastmod>2026-05-01T12:00:00.000Z</lastmod>");

    const sitemapMd = await readFile(result.files.sitemapMd, "utf8");
    expect(sitemapMd).toContain("## Get Started");
    expect(sitemapMd).toContain("[Quickstart](/docs/quickstart)");
    expect(sitemapMd).toContain("## Reference");

    const robotsTxt = await readFile(result.files.robotsTxt, "utf8");
    expect(robotsTxt).toContain("User-agent: GPTBot");
    expect(robotsTxt).toContain("User-agent: ClaudeBot");
    expect(robotsTxt).toContain("Allow: /llms.txt");
    expect(robotsTxt).not.toContain("Disallow: /llms.txt");

    expect(result.manifest.pages).toContainEqual(
      expect.objectContaining({
        markdownUrlPath: "/docs/quickstart.md",
        urlPath: "/docs/quickstart",
      })
    );
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
});

describe("agent readability helpers", () => {
  const manifest = {
    version: 1,
    generatedAt: "2026-05-01T00:00:00.000Z",
    baseUrl: "https://example.com",
    product: { name: "Leadtype", summary: "Docs pipeline." },
    files: {
      robotsTxt: "/docs/robots.txt",
      sitemapMd: "/docs/sitemap.md",
      sitemapXml: "/docs/sitemap.xml",
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
      url: "https://example.com/docs/quickstart",
      dateModified: "2026-05-01T12:00:00.000Z",
    });
    expect(renderJsonLdScript(page, manifest)).toContain(
      '<script type="application/ld+json">'
    );
    expect(renderJsonLdScript(page, manifest)).toContain(
      "Quickstart \\u003cstart\\u003e"
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
      Link: '<https://example.com/docs>; rel="canonical"',
      "Cache-Control": "public, max-age=300, must-revalidate",
    });
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
      '<http://localhost:3000/missing-page>; rel="canonical"'
    );
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

  it("recognizes /llms-full.txt as an artifact (not a missing markdown page)", () => {
    expect(isAgentReadabilityArtifactPath("/llms-full.txt")).toBe(true);
    expect(isAgentReadabilityArtifactPath("/docs/llms-full.txt")).toBe(false);
    expect(
      isAgentReadabilityArtifactPath("/docs/llms-full/get-started.txt")
    ).toBe(false);
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
      robotsTxt: "/docs/robots.txt",
      sitemapMd: "/docs/sitemap.md",
      sitemapXml: "/docs/sitemap.xml",
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
    expect(body).toContain("User-agent: Bingbot");
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
      robotsTxt: "/docs/robots.txt",
      sitemapMd: "/docs/sitemap.md",
      sitemapXml: "/docs/sitemap.xml",
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

  it("respects jsonLdMetaKey override", () => {
    const head = createDocsHead({
      urlPath: "/docs/quickstart",
      manifest,
      jsonLdMetaKey: "ldJson",
    });
    expect(head.meta.find((m) => "ldJson" in m)).toBeDefined();
    expect(head.meta.find((m) => "script:ld+json" in m)).toBeUndefined();
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

describe("resolveDocsNavigation", () => {
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
