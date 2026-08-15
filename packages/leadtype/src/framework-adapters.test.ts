import { describe, expect, it } from "vitest";
import {
  createLoadPageData as createAstroLoadPageData,
  createDocsEndpoint,
  createGetStaticPaths,
  createMarkdownStaticPaths,
} from "./astro";
import type { AgentReadabilityManifest } from "./llm/readability";
import {
  createDocsProxy,
  createGenerateStaticParams,
  createLoadPageData as createNextLoadPageData,
} from "./next";
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

function buildPage(slug: string[], urlPath?: string): DocsPage {
  const relativePath = slug.join("/") || "index";
  return {
    slug,
    urlPath: urlPath ?? `/docs/${relativePath}`.replace("/index", ""),
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

function buildSourceFromPages(
  pages: DocsPage[],
  routePrefix?: string
): DocsSource {
  return {
    contentDir: "/content",
    ...(routePrefix ? { routePrefix } : {}),
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

function buildSource(): DocsSource {
  return buildSourceFromPages([
    buildPage([]),
    buildPage(["quickstart"]),
    buildPage(["guides", "api"]),
  ]);
}

/**
 * A single collection whose `mounts` move part of the tree: the file slug and
 * the advertised URL disagree, which is exactly where slug-derived params
 * used to misroute.
 */
function buildMountedSource(): DocsSource {
  return buildSourceFromPages([
    buildPage([]),
    buildPage(["quickstart"]),
    // mounts: [{ pathPrefix: "policies", urlPrefix: "/docs/legal" }]
    buildPage(["policies", "privacy"], "/docs/legal/privacy"),
  ]);
}

type ProjectishPage = DocsPage & { collection: string };

/**
 * The shape `createDocsProject()` hands to adapters: pages tagged with their
 * collection, URLs carrying each collection's routePrefix, `loadPage`
 * resolving the full route path first — and the project's own `routePrefix`
 * set to the primary collection's.
 */
function buildProjectSource(): DocsSource {
  const pages: ProjectishPage[] = [
    { ...buildPage([]), collection: "docs" },
    { ...buildPage(["quickstart"]), collection: "docs" },
    { ...buildPage(["1-0"], "/changelog/1-0"), collection: "changelog" },
  ];
  const base = buildSourceFromPages(pages, "/docs");
  return {
    ...base,
    listPages: async () => pages,
    loadPage: async (slug) => {
      const wanted = (Array.isArray(slug) ? slug : slug.split("/"))
        .filter(Boolean)
        .join("/");
      return (
        pages.find((page) => page.urlPath.replace(/^\//, "") === wanted) ??
        pages.find((page) => page.slug.join("/") === wanted) ??
        null
      );
    },
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
    await expect(createGenerateStaticParams({ source })()).resolves.toEqual([
      { slug: [] },
      { slug: ["quickstart"] },
      { slug: ["guides", "api"] },
    ]);
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

  it("derives params from the mount-aware urlPath, not the file slug", async () => {
    const source = buildMountedSource();
    // The mounted page lives at /docs/legal/privacy; its file slug
    // (policies/privacy) is the URL the sitemap never advertises.
    await expect(createGenerateStaticParams({ source })()).resolves.toEqual([
      { slug: [] },
      { slug: ["quickstart"] },
      { slug: ["legal", "privacy"] },
    ]);
    await expect(createGetStaticPaths({ source })()).resolves.toEqual([
      { params: { slug: undefined } },
      { params: { slug: "quickstart" } },
      { params: { slug: "legal/privacy" } },
    ]);
    await expect(createMarkdownStaticPaths({ source })()).resolves.toEqual([
      { params: { slug: "index" } },
      { params: { slug: "quickstart" } },
      { params: { slug: "legal/privacy" } },
    ]);
    await expect(createEntries({ source })()).resolves.toEqual([
      { slug: "" },
      { slug: "quickstart" },
      { slug: "legal/privacy" },
    ]);
    await expect(createStaticParams({ source })()).resolves.toEqual([
      { _splat: "" },
      { _splat: "quickstart" },
      { _splat: "legal/privacy" },
    ]);
    await expect(createPrerenderRoutes({ source })()).resolves.toEqual([
      "/docs",
      "/docs/quickstart",
      "/docs/legal/privacy",
    ]);
    // Explicit basePath re-roots the mount-aware slug, not the file slug.
    await expect(
      createPrerenderRoutes({ source, basePath: "/guide" })()
    ).resolves.toEqual(["/guide", "/guide/quickstart", "/guide/legal/privacy"]);
  });

  it("loads the page a mount-aware param addresses", async () => {
    const source = buildMountedSource();
    // Round-trip: the params emitted above must load the page they address,
    // even though they differ from the page's file slug.
    await expect(
      createNextLoadPageData({ source })(["legal", "privacy"])
    ).resolves.toMatchObject({ title: "policies/privacy" });
    await expect(
      createAstroLoadPageData({ source })("legal/privacy")
    ).resolves.toMatchObject({ title: "policies/privacy" });
    await expect(
      createSvelteKitLoadPageData({ source })({
        params: { slug: "legal/privacy" },
      })
    ).resolves.toMatchObject({ title: "policies/privacy" });
    await expect(
      createTanStackLoadPageData({ source })("legal/privacy")
    ).resolves.toMatchObject({ title: "policies/privacy" });
    await expect(
      createNuxtLoadPageData({ source })({ slug: ["legal", "privacy"] })
    ).resolves.toMatchObject({ title: "policies/privacy" });
    // Raw file slugs keep resolving — the historical fallback.
    await expect(
      createNextLoadPageData({ source })(["policies", "privacy"])
    ).resolves.toMatchObject({ title: "policies/privacy" });
    // Re-rooted Nuxt routes must load the mounted page, not 404 on the
    // file slug `legal/privacy` or the re-rooted path `/guide/legal/privacy`.
    await expect(
      createNuxtLoadPageData({ source, basePath: "/guide" })({
        slug: ["legal", "privacy"],
      })
    ).resolves.toMatchObject({ title: "policies/privacy" });
  });

  it("prefers a mounted route over a colliding raw slug", async () => {
    const source = buildSourceFromPages([
      // legacy/index.mdx mounted at /docs/foo
      buildPage(["legacy"], "/docs/foo"),
      // policies/index.mdx mounted at /docs/legacy
      buildPage(["policies"], "/docs/legacy"),
    ]);
    // Generated params are urlPath-derived, so `legacy` addresses the page
    // advertised at /docs/legacy. The raw slug of the other page still
    // loads via its own route (`foo`).
    await expect(
      createNextLoadPageData({ source })(["legacy"])
    ).resolves.toMatchObject({ title: "policies" });
    await expect(
      createNextLoadPageData({ source })(["foo"])
    ).resolves.toMatchObject({ title: "legacy" });
  });

  it("uses a collection source's own routePrefix as the route base", async () => {
    const source = buildSourceFromPages(
      [buildPage([], "/changelog"), buildPage(["1-0"], "/changelog/1-0")],
      "/changelog"
    );
    // project.getSource("changelog") under app/changelog/[[...slug]]: params
    // stay collection-local with no basePath handed to any adapter.
    await expect(createGenerateStaticParams({ source })()).resolves.toEqual([
      { slug: [] },
      { slug: ["1-0"] },
    ]);
    await expect(createEntries({ source })()).resolves.toEqual([
      { slug: "" },
      { slug: "1-0" },
    ]);
    // Nuxt prerenders full paths, so the collection's real routes come out —
    // not `/docs/1-0`.
    await expect(createPrerenderRoutes({ source })()).resolves.toEqual([
      "/changelog",
      "/changelog/1-0",
    ]);
    // An explicit basePath still re-roots, for a catch-all mounted elsewhere.
    await expect(
      createPrerenderRoutes({ source, basePath: "/releases" })()
    ).resolves.toEqual(["/releases", "/releases/1-0"]);
    await expect(
      createNextLoadPageData({ source })(["1-0"])
    ).resolves.toMatchObject({ title: "1-0" });
  });

  it("serves a multi-collection project from one site-root catch-all via basePath", async () => {
    const source = buildProjectSource();
    await expect(
      createGenerateStaticParams({ source, basePath: "/" })()
    ).resolves.toEqual([
      { slug: ["docs"] },
      { slug: ["docs", "quickstart"] },
      { slug: ["changelog", "1-0"] },
    ]);
    await expect(
      createStaticParams({ source, basePath: "/" })()
    ).resolves.toEqual([
      { _splat: "docs" },
      { _splat: "docs/quickstart" },
      { _splat: "changelog/1-0" },
    ]);
    // The load side resolves those params as route paths, so the changelog
    // page comes from the changelog collection rather than a local-slug guess.
    await expect(
      createNextLoadPageData({ source, basePath: "/" })(["changelog", "1-0"])
    ).resolves.toMatchObject({ title: "1-0", collection: "changelog" });
    await expect(
      createTanStackLoadPageData({ source, basePath: "/" })("docs/quickstart")
    ).resolves.toMatchObject({ title: "quickstart", collection: "docs" });
  });

  it("refuses to emit params that would misroute a collection", async () => {
    const source = buildProjectSource();
    // The project's own base is its primary collection's prefix (/docs); the
    // changelog page cannot be served by a /docs catch-all, so enumerating
    // params for one is an error naming the page and the fixes — not a silent
    // duplicate or misroute.
    const outsideBase =
      /"\/changelog\/1-0", outside the route base "\/docs".*getSource\(key\).*site-root catch-all/s;
    await expect(createGenerateStaticParams({ source })()).rejects.toThrow(
      outsideBase
    );
    await expect(createGetStaticPaths({ source })()).rejects.toThrow(
      outsideBase
    );
    await expect(createEntries({ source })()).rejects.toThrow(outsideBase);
    await expect(createStaticParams({ source })()).rejects.toThrow(outsideBase);
    // Nuxt with an explicit basePath re-roots and hits the same wall…
    await expect(
      createPrerenderRoutes({ source, basePath: "/guide" })()
    ).rejects.toThrow(outsideBase);
    // …but without one it prerenders every page's real route, prefix and all.
    await expect(createPrerenderRoutes({ source })()).resolves.toEqual([
      "/docs",
      "/docs/quickstart",
      "/changelog/1-0",
    ]);
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
