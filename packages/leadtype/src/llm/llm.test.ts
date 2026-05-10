import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptsMarkdownHeader,
  createAgentMarkdownResponse,
  createMarkdownResponseHeaders,
  enrichMarkdownFrontmatter,
  generateAgentReadabilityArtifacts,
  generateLLMFullContextFiles,
  generateLlmsTxt,
  isAgentReadabilityArtifactPath,
  isAgentUserAgent,
  renderJsonLd,
  renderJsonLdScript,
  renderMissingMarkdown,
  renderRobotsTxt,
  renderSitemapXml,
  resolveDocsNavigation,
  resolveMarkdownMirrorTarget,
} from "./llm";

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
});

describe("generateLLMFullContextFiles", () => {
  it("emits sub-routers and leaves at nested paths", async () => {
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

    const rootRouter = await readFile(
      path.join(projectDir, "docs", "llms-full.txt"),
      "utf8"
    );
    expect(rootRouter).toContain("Frameworks");

    const frameworksRouter = await readFile(
      path.join(projectDir, "docs", "llms-full", "frameworks.txt"),
      "utf8"
    );
    expect(frameworksRouter).toContain("# c15t Frameworks Full Context");
    expect(frameworksRouter).toContain("React");

    const reactLeaf = await readFile(
      path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt"),
      "utf8"
    );
    expect(reactLeaf).toContain("# c15t React Full Context");
    expect(reactLeaf).toContain("React Quickstart");
    expect(reactLeaf).not.toContain("Next.js Quickstart");

    const nextLeaf = await readFile(
      path.join(projectDir, "docs", "llms-full", "frameworks", "next.txt"),
      "utf8"
    );
    expect(nextLeaf).toContain("Next.js Quickstart");
    expect(nextLeaf).not.toContain("React Quickstart");
  });

  it("inlines a multi-group page in every named leaf", async () => {
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

    const searchLeaf = await readFile(
      path.join(projectDir, "docs", "llms-full", "search.txt"),
      "utf8"
    );
    const selfHostLeaf = await readFile(
      path.join(projectDir, "docs", "llms-full", "self-host.txt"),
      "utf8"
    );
    expect(searchLeaf).toContain("Rate Limiting");
    expect(selfHostLeaf).toContain("Rate Limiting");
  });

  it("clears stale nested files before rewriting the group tree", async () => {
    const projectDir = await createTempProject();
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

    expect(
      existsSync(
        path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt")
      )
    ).toBe(true);

    // Rerun with a flatter shape; the nested react.txt must be removed.
    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      groups: [
        { slug: "frameworks", title: "Frameworks", description: "Flat." },
      ],
    });

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
      baseUrl: "https://docs.example.com",
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
      "<loc>https://docs.example.com/docs/quickstart</loc>"
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
    expect(acceptsMarkdownHeader("text/html, text/markdown")).toBe(false);
    expect(isAgentUserAgent("ClaudeBot/1.0")).toBe(true);
    expect(
      createMarkdownResponseHeaders({
        canonicalUrl: "https://example.com/docs",
        includeUserAgentVary: true,
      })
    ).toEqual({
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept, User-Agent",
      Link: '<https://example.com/docs>; rel="canonical"',
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

  it("creates complete markdown responses for docs and agent 404s", () => {
    const markdown = `---
title: Quickstart
description: Install.
lastModified: 2026-05-01T12:00:00.000Z
---
# Quickstart
`;

    const docsResponse = createAgentMarkdownResponse({
      urlPath: "/docs/quickstart",
      headers: { "user-agent": "ClaudeBot/1.0" },
      manifest,
      readMarkdownFile: () => markdown,
    });

    expect(docsResponse).toMatchObject({
      status: 200,
      found: true,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        Vary: "Accept, User-Agent",
      },
      target: { filePath: "docs/quickstart.md" },
    });
    expect(docsResponse?.body).toContain("# Quickstart");
    expect(docsResponse?.body).toContain("canonical_url:");

    const missingResponse = createAgentMarkdownResponse({
      urlPath: "/missing-page",
      headers: { accept: "text/markdown" },
      manifest,
      requestOrigin: "http://localhost:3000",
      now: new Date("2026-05-02T00:00:00.000Z"),
      readMarkdownFile: () => null,
    });

    expect(missingResponse).toMatchObject({
      status: 200,
      found: false,
      headers: {
        Link: '<http://localhost:3000/missing-page>; rel="canonical"',
      },
    });
    expect(missingResponse?.body).toContain("# Page not found");

    expect(
      renderMissingMarkdown({
        urlPath: "/missing-page",
        canonicalUrl: "https://example.com/missing-page",
        lastUpdated: "2026-05-02T00:00:00.000Z",
      })
    ).toContain('last_updated: "2026-05-02T00:00:00.000Z"');
  });
});

describe("resolveDocsNavigation", () => {
  it("returns the group tree, attached pages, and unknown-group references", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "frameworks/react.mdx",
        frontmatter: "title: React\ndescription: React.\ngroup: react",
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

    const ungroupedTitles = nav.ungrouped.map((p) => p.title);
    expect(ungroupedTitles).toContain("Ungrouped");

    expect(nav.unknown).toContainEqual({
      urlPath: "/docs/rate-limiting",
      slug: "mystery",
    });
  });
});
