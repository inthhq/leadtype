import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentPageInput, generateAgentArtifacts } from "./llm";
import { normalizeAgentReadabilityManifest } from "./readability";

const tempDirs: string[] = [];

async function createTempOutDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-agent-artifacts-"));
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

const BASE_URL = "https://cookiebench.example";

const PAGES: AgentPageInput[] = [
  {
    urlPath: "/",
    title: "CookieBench",
    description: "Benchmarks for consent banners.",
    content: "# CookieBench\n\nWelcome to the benchmark.",
  },
  {
    urlPath: "/benchmarks/chrome",
    title: "Chrome",
    description: "Chrome consent benchmark results.",
    content: "## Results\n\nChrome numbers.",
    lastModified: "2026-06-01T00:00:00.000Z",
    groups: ["benchmarks"],
  },
  {
    urlPath: "/benchmarks/firefox",
    title: "Firefox",
    description: "Firefox consent benchmark results.",
    content: "## Results\n\nFirefox numbers.",
    groups: ["benchmarks"],
    order: 1,
  },
];

function baseConfig(outDir: string) {
  return {
    outDir,
    baseUrl: BASE_URL,
    product: {
      name: "CookieBench",
      tagline: "Benchmarks for consent banners.",
    },
    pages: PAGES,
    groups: [{ slug: "benchmarks", title: "Benchmarks" }],
  };
}

describe("generateAgentArtifacts", () => {
  it("emits the full artifact set from an in-memory page list", async () => {
    const outDir = await createTempOutDir();
    const result = await generateAgentArtifacts(baseConfig(outDir));

    const llmsTxt = await readFile(result.files.llmsTxt, "utf-8");
    expect(llmsTxt).toContain("# CookieBench");
    expect(llmsTxt).toContain("> Benchmarks for consent banners.");
    expect(llmsTxt).toContain("## Benchmarks");
    expect(llmsTxt).toContain("(/benchmarks/chrome.md)");
    expect(llmsTxt).toContain("## Other");

    const wellKnown = await readFile(result.files.wellKnownLlmsTxt, "utf-8");
    expect(wellKnown).toBe(llmsTxt);

    expect(result.files.robotsTxt).toBeDefined();
    const robots = await readFile(result.files.robotsTxt ?? "", "utf-8");
    expect(robots).toContain("Content-Signal:");
    expect(robots).toContain(`Sitemap: ${BASE_URL}/sitemap.xml`);
    expect(robots).toContain("Allow: /llms.txt");

    expect(result.files.apiCatalog).toBeDefined();
    const apiCatalog = JSON.parse(
      await readFile(result.files.apiCatalog ?? "", "utf-8")
    );
    expect(apiCatalog.linkset[0]["api-catalog"][0].href).toBe(
      `${BASE_URL}/.well-known/api-catalog`
    );

    const sitemapXml = await readFile(result.files.sitemapXml ?? "", "utf-8");
    expect(sitemapXml).toContain(`<loc>${BASE_URL}/benchmarks/chrome</loc>`);
    expect(sitemapXml).toContain("<lastmod>2026-06-01T00:00:00.000Z</lastmod>");

    const sitemapMd = await readFile(result.files.sitemapMd ?? "", "utf-8");
    expect(sitemapMd).toContain("# Sitemap");
    expect(sitemapMd).toContain("## Benchmarks");
  });

  it("keeps manifest pages in the authored input order", async () => {
    const outDir = await createTempOutDir();
    // Neither alphabetical nor group-navigation order (firefox has order: 1,
    // so nav order would move it ahead of chrome and trail the root page).
    const reordered = [PAGES[2], PAGES[0], PAGES[1]].filter(
      (page): page is AgentPageInput => page !== undefined
    );
    const result = await generateAgentArtifacts({
      ...baseConfig(outDir),
      pages: reordered,
    });

    expect(result.manifest.pages.map((page) => page.urlPath)).toEqual([
      "/benchmarks/firefox",
      "/",
      "/benchmarks/chrome",
    ]);
  });

  it("writes markdown mirrors at urlPath locations with spec frontmatter", async () => {
    const outDir = await createTempOutDir();
    const result = await generateAgentArtifacts(baseConfig(outDir));

    expect(result.files.markdown).toContain(
      path.join(outDir, "benchmarks", "chrome.md")
    );
    const mirror = await readFile(
      path.join(outDir, "benchmarks", "chrome.md"),
      "utf-8"
    );
    expect(mirror).toContain('title: "Chrome"');
    expect(mirror).toContain(
      'description: "Chrome consent benchmark results."'
    );
    expect(mirror).toContain(`canonical_url: "${BASE_URL}/benchmarks/chrome"`);
    expect(mirror).toContain('last_updated: "2026-06-01T00:00:00.000Z"');
    expect(mirror).toContain("Chrome numbers.");

    const rootMirror = await readFile(path.join(outDir, "index.md"), "utf-8");
    expect(rootMirror).toContain(`canonical_url: "${BASE_URL}/"`);
    expect(rootMirror).toContain("Welcome to the benchmark.");
  });

  it("produces a manifest the runtime helpers accept", async () => {
    const outDir = await createTempOutDir();
    const result = await generateAgentArtifacts({
      ...baseConfig(outDir),
      organization: { name: "Consent.io", url: "https://consent.io" },
      agents: {
        robots: { policy: "block-training" },
        seo: { ogImage: `${BASE_URL}/og.png` },
      },
    });

    const raw = JSON.parse(await readFile(result.files.manifest, "utf-8"));
    const manifest = normalizeAgentReadabilityManifest(raw);
    expect(manifest.baseUrl).toBe(BASE_URL);
    expect(manifest.pages).toHaveLength(3);
    const chrome = manifest.pages.find(
      (page) => page.urlPath === "/benchmarks/chrome"
    );
    expect(chrome?.markdownUrlPath).toBe("/benchmarks/chrome.md");
    expect(chrome?.markdownAbsoluteUrl).toBe(
      `${BASE_URL}/benchmarks/chrome.md`
    );
    const root = manifest.pages.find((page) => page.urlPath === "/");
    expect(root?.markdownUrlPath).toBe("/index.md");
    expect(manifest.jsonLd?.organization?.name).toBe("Consent.io");
    expect(manifest.seo?.ogImage).toBe(`${BASE_URL}/og.png`);
    expect(manifest.navigation.groups.map((group) => group.slug)).toContain(
      "benchmarks"
    );

    const robots = await readFile(result.files.robotsTxt ?? "", "utf-8");
    expect(robots).toContain("User-agent: GPTBot\nDisallow: /");
    expect(robots).toContain("ai-train=no");
  });

  it("falls back to frontmatter fields when explicit ones are omitted", async () => {
    const outDir = await createTempOutDir();
    const result = await generateAgentArtifacts({
      ...baseConfig(outDir),
      pages: [
        {
          urlPath: "/blog/launch-post",
          content: `---
title: Launch Post
description: We launched.
last_updated: 2026-05-01
---

Body text.`,
        },
      ],
      groups: [],
    });

    const page = result.manifest.pages[0];
    expect(page?.title).toBe("Launch Post");
    expect(page?.description).toBe("We launched.");
    expect(page?.lastModified).toBe(new Date("2026-05-01").toISOString());
    const mirror = await readFile(
      path.join(outDir, "blog", "launch-post.md"),
      "utf-8"
    );
    expect(mirror).toContain('title: "Launch Post"');
    expect(mirror).not.toContain("---\n---");
    expect(mirror).toContain("Body text.");

    const llmsTxt = await readFile(result.files.llmsTxt, "utf-8");
    expect(llmsTxt).toContain("## Pages");
    expect(llmsTxt).toContain("(/blog/launch-post.md)");
  });

  it("skips root crawler files when emitRootCrawlerFiles is false", async () => {
    const outDir = await createTempOutDir();
    const result = await generateAgentArtifacts({
      ...baseConfig(outDir),
      emitRootCrawlerFiles: false,
    });

    expect(result.files.robotsTxt).toBeUndefined();
    expect(result.files.sitemapMd).toBeUndefined();
    expect(result.files.sitemapXml).toBeUndefined();
    expect(result.files.apiCatalog).toBeUndefined();
    await expect(
      readFile(path.join(outDir, "robots.txt"), "utf-8")
    ).rejects.toThrow();
    await expect(
      readFile(path.join(outDir, ".well-known", "api-catalog"), "utf-8")
    ).rejects.toThrow();
    await expect(readFile(result.files.llmsTxt, "utf-8")).resolves.toContain(
      "# CookieBench"
    );
  });

  it("rejects duplicate, relative, and query-bearing page routes", async () => {
    const outDir = await createTempOutDir();
    await expect(
      generateAgentArtifacts({
        ...baseConfig(outDir),
        pages: [
          { urlPath: "/a", title: "A", content: "a" },
          { urlPath: "/a/", title: "A again", content: "a" },
        ],
      })
    ).rejects.toThrow('duplicate page route "/a"');
    await expect(
      generateAgentArtifacts({
        ...baseConfig(outDir),
        pages: [{ urlPath: "relative", title: "Bad", content: "x" }],
      })
    ).rejects.toThrow('must start with "/"');
    await expect(
      generateAgentArtifacts({
        ...baseConfig(outDir),
        pages: [{ urlPath: "/a?b=1", title: "Bad", content: "x" }],
      })
    ).rejects.toThrow("query or hash");
    await expect(
      generateAgentArtifacts({ ...baseConfig(outDir), pages: [] })
    ).rejects.toThrow("config.pages is empty");
  });

  it("rejects traversal segments so mirrors cannot escape outDir", async () => {
    const outDir = await createTempOutDir();
    const escapePaths = ["/../../escaped", "/a/../b", "/a/./b", "/a//b"];
    for (const urlPath of escapePaths) {
      await expect(
        generateAgentArtifacts({
          ...baseConfig(outDir),
          pages: [{ urlPath, title: "Bad", content: "x" }],
        })
      ).rejects.toThrow('".." segments');
    }
    await expect(
      readFile(path.join(path.dirname(outDir), "escaped.md"), "utf-8")
    ).rejects.toThrow();
  });
});
