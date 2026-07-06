import { describe, expect, it } from "vitest";
import {
  createLoadPageData as createAstroLoadPageData,
  createDocsEndpoint,
  createGetStaticPaths,
  createMarkdownStaticPaths,
} from "./astro";
import type { AgentReadabilityManifest } from "./llm/readability";
import { createDocsProxy } from "./next";
import {
  createLoadPageData as createNuxtLoadPageData,
  createPrerenderRoutes,
  createRequiredNitroDocsHandler,
} from "./nuxt";
import type { DocsPage, DocsSource } from "./source";
import {
  createEntries,
  createLoadPageData as createSvelteKitLoadPageData,
  createDocsServerHandler as createSvelteKitServerHandler,
} from "./sveltekit";
import {
  createStaticParams,
  createLoadPageData as createTanStackLoadPageData,
  createDocsServerHandler as createTanStackServerHandler,
} from "./tanstack-start";

function buildPage(slug: string[]): DocsPage {
  const relativePath = slug.join("/") || "index";
  return {
    slug,
    urlPath: `/docs/${relativePath}`.replace("/index", ""),
    relativePath,
    extension: ".mdx",
    filePath: `/content/${relativePath}.mdx`,
    title: relativePath,
    description: "",
    groups: [],
    frontmatter: {},
    markdown: `# ${relativePath}`,
    ast: { type: "root", children: [] } as never,
    toc: [],
  };
}

function buildSource(): DocsSource {
  const pages = [
    buildPage([]),
    buildPage(["quickstart"]),
    buildPage(["guides", "api"]),
  ];
  return {
    contentDir: "/content",
    getNavigation: async () => ({ groups: [], ungrouped: [], unknown: [] }),
    listPages: async () => pages,
    loadPage: async (slug) => {
      const key = Array.isArray(slug) ? slug.join("/") : slug;
      return pages.find((page) => page.slug.join("/") === key) ?? null;
    },
    buildSearchIndex: () => {
      throw new Error("not used");
    },
    resolveInclude: () => {
      throw new Error("not used");
    },
    cleanup: async () => undefined,
  };
}

function buildManifest(): AgentReadabilityManifest {
  return {
    version: 1,
    generatedAt: "2026-05-15T00:00:00.000Z",
    baseUrl: "https://example.com",
    product: { name: "Test", summary: "" },
    pages: [
      {
        title: "Quickstart",
        description: "",
        urlPath: "/docs/quickstart",
        absoluteUrl: "https://example.com/docs/quickstart",
        markdownUrlPath: "/docs/quickstart.md",
        markdownAbsoluteUrl: "https://example.com/docs/quickstart.md",
        relativePath: "quickstart",
        groups: [],
        lastModified: "2026-05-15T00:00:00.000Z",
      },
    ],
    navigation: { groups: [], ungrouped: [], unknown: [] },
    files: {
      robotsTxt: "robots.txt",
      sitemapMd: "sitemap.md",
      sitemapXml: "sitemap.xml",
    },
  };
}

describe("framework adapter route helpers", () => {
  it("creates native static route shapes from the source", async () => {
    const source = buildSource();
    await expect(createGetStaticPaths({ source })()).resolves.toEqual([
      { params: { slug: undefined } },
      { params: { slug: "quickstart" } },
      { params: { slug: "guides/api" } },
    ]);
    await expect(createMarkdownStaticPaths({ source })()).resolves.toEqual([
      { params: { slug: "index" } },
      { params: { slug: "quickstart" } },
      { params: { slug: "guides/api" } },
    ]);
    await expect(createEntries({ source })()).resolves.toEqual([
      { slug: "" },
      { slug: "quickstart" },
      { slug: "guides/api" },
    ]);
    await expect(createStaticParams({ source })()).resolves.toEqual([
      { _splat: "" },
      { _splat: "quickstart" },
      { _splat: "guides/api" },
    ]);
    await expect(createPrerenderRoutes({ source })()).resolves.toEqual([
      "/docs",
      "/docs/quickstart",
      "/docs/guides/api",
    ]);
    await expect(
      createPrerenderRoutes({ source, basePath: "/guide" })()
    ).resolves.toEqual(["/guide", "/guide/quickstart", "/guide/guides/api"]);
  });

  it("loads docs pages from each framework's route params", async () => {
    const source = buildSource();
    await expect(
      createAstroLoadPageData({ source })("quickstart")
    ).resolves.toMatchObject({ title: "quickstart" });
    await expect(
      createSvelteKitLoadPageData({ source })({
        params: { slug: "guides/api" },
      })
    ).resolves.toMatchObject({ title: "guides/api" });
    await expect(
      createTanStackLoadPageData({ source })("guides/api")
    ).resolves.toMatchObject({ title: "guides/api" });
    await expect(
      createNuxtLoadPageData({ source })({ slug: ["guides", "api"] })
    ).resolves.toMatchObject({ title: "guides/api" });
  });

  it("serves generated markdown through framework request handlers", async () => {
    const manifest = buildManifest();
    const readMarkdownFile = () => "# Quickstart\n\nHello.";
    const request = new Request("https://example.com/docs/quickstart.md");

    await expect(
      createDocsEndpoint({ manifest, readMarkdownFile })({ request }).then(
        (response) => response.text()
      )
    ).resolves.toContain("Hello.");

    await expect(
      createDocsEndpoint({ manifest, readMarkdownFile })({
        params: { slug: "sitemap" },
        request: new Request("https://example.com/sitemap.md"),
      }).then((response) => response.text())
    ).resolves.toContain("Structured documentation sitemap");

    await expect(
      createSvelteKitServerHandler({ manifest, readMarkdownFile })({
        request,
      }).then((response) => response.text())
    ).resolves.toContain("Hello.");

    await expect(
      createTanStackServerHandler({ manifest, readMarkdownFile })(request).then(
        (response) => response.text()
      )
    ).resolves.toContain("Hello.");

    await expect(
      createRequiredNitroDocsHandler({ manifest, readMarkdownFile })({
        request,
      }).then((response) => response.text())
    ).resolves.toContain("Hello.");

    await expect(
      createRequiredNitroDocsHandler({
        manifest,
      })({
        request: new Request("https://example.com/robots.txt"),
      }).then((response) => response.text())
    ).resolves.toContain("/sitemap.xml");
  });

  it("serves markdown through the Next proxy helper", async () => {
    const manifest = buildManifest();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("# Quickstart\n\nHello.")) as typeof fetch;
    try {
      await expect(
        createDocsProxy({ manifest })(
          new Request("https://example.com/docs/quickstart.md")
        ).then((response) => response.text())
      ).resolves.toContain("Hello.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("treats Next proxy markdown fetch failures as missing markdown", async () => {
    const manifest = buildManifest();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("network failure");
    }) as typeof fetch;
    try {
      await expect(
        createDocsProxy({ manifest })(
          new Request("https://example.com/docs/quickstart.md")
        )
      ).resolves.toMatchObject({ status: 200 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
