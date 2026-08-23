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

  it("serves the API catalog from every adapter, or 404s without APIs", async () => {
    const manifest = buildManifest();
    const withApis: AgentReadabilityManifest = {
      ...manifest,
      files: { ...manifest.files, apiCatalog: "/.well-known/api-catalog" },
      apis: [
        {
          href: "/ask",
          title: "Documentation query API",
          serviceDoc: { href: "/docs/quickstart", type: "text/html" },
        },
      ],
    };
    const catalogRequest = new Request(
      "https://example.com/.well-known/api-catalog"
    );

    const svelteKit = await createSvelteKitServerHandler({
      manifest: withApis,
    })({ request: catalogRequest });
    expect(svelteKit.headers.get("Content-Type")).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
    );
    const body = await svelteKit.json();
    expect(body.linkset[0].item[0].href).toBe("https://example.com/ask");

    const tanStack = await createTanStackServerHandler({ manifest: withApis })(
      catalogRequest
    );
    expect(tanStack.headers.get("Link")).toContain('rel="api-catalog"');

    const head = await createRequiredNitroDocsHandler({ manifest: withApis })({
      request: new Request("https://example.com/.well-known/api-catalog", {
        method: "HEAD",
      }),
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("Link")).toContain('rel="api-catalog"');
    expect(await head.text()).toBe("");

    const post = await createRequiredNitroDocsHandler({ manifest: withApis })({
      request: new Request("https://example.com/.well-known/api-catalog", {
        method: "POST",
      }),
    });
    expect(post.status).toBe(404);

    // The base manifest declares no APIs, so there is no catalog to serve.
    const missing = await createRequiredNitroDocsHandler({ manifest })({
      request: catalogRequest,
    });
    expect(missing.status).toBe(404);
  });

  it("serves artifact routes only for GET and HEAD", async () => {
    const manifest = buildManifest();
    const withApis: AgentReadabilityManifest = {
      ...manifest,
      files: { ...manifest.files, apiCatalog: "/.well-known/api-catalog" },
      apis: [{ href: "/ask" }],
    };
    const handler = createRequiredNitroDocsHandler({ manifest: withApis });
    for (const pathname of [
      "/sitemap.xml",
      "/sitemap.md",
      "/robots.txt",
      "/.well-known/api-catalog",
    ]) {
      const url = `https://example.com${pathname}`;
      expect((await handler({ request: new Request(url) })).status).toBe(200);
      const head = await handler({
        request: new Request(url, { method: "HEAD" }),
      });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      for (const method of ["POST", "OPTIONS"]) {
        const response = await handler({
          request: new Request(url, { method }),
        });
        expect(response.status).toBe(404);
        expect(await response.text()).toBe("");
      }
    }
  });

  it("serves markdown through the Next proxy helper", async () => {
    const manifest = buildManifest();
    manifest.pages[0] = {
      ...manifest.pages[0],
      markdownFilePath: "docs/100%-coverage.md",
    };
    const originalFetch = globalThis.fetch;
    let fetchedUrl = "";
    globalThis.fetch = (async (input) => {
      fetchedUrl = input.toString();
      return new Response("# Quickstart\n\nHello.");
    }) as typeof fetch;
    try {
      await expect(
        createDocsProxy({ manifest, publicPathPrefix: "/_leadtype" })(
          new Request("https://example.com/docs/quickstart.md")
        ).then((response) => response.text())
      ).resolves.toContain("Hello.");
      expect(fetchedUrl).toBe(
        "https://example.com/_leadtype/docs/100%25-coverage.md"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries a legacy BYOP root mirror after a Next HTML fallback", async () => {
    const manifest = buildManifest();
    manifest.pages[0] = {
      ...manifest.pages[0],
      urlPath: "/benchmarks/chrome",
      absoluteUrl: "https://example.com/benchmarks/chrome",
      markdownUrlPath: "/benchmarks/chrome.md",
      markdownAbsoluteUrl: "https://example.com/benchmarks/chrome.md",
      relativePath: "benchmarks/chrome",
    };
    const originalFetch = globalThis.fetch;
    const fetchedUrls: string[] = [];
    const reportedErrors: unknown[] = [];
    globalThis.fetch = (async (input) => {
      const url = input.toString();
      fetchedUrls.push(url);
      if (url.endsWith("/docs/benchmarks/chrome.md")) {
        return new Response("<html><body>Fallback</body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response(
        `---
canonical_url: "https://example.com/benchmarks/chrome"
last_updated: "2026-05-15T00:00:00.000Z"
---
# Chrome benchmarks
`,
        {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        }
      );
    }) as typeof fetch;
    try {
      const response = await createDocsProxy({
        manifest,
        onReadError: (_target, cause) => {
          reportedErrors.push(cause);
        },
      })(new Request("https://example.com/benchmarks/chrome.md"));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("# Chrome benchmarks");
      expect(fetchedUrls).toEqual([
        "https://example.com/docs/benchmarks/chrome.md",
        "https://example.com/benchmarks/chrome.md",
      ]);
      expect(reportedErrors).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("never fetches an encoded traversal target through the Next proxy", async () => {
    const manifest = buildManifest();
    manifest.pages[0] = {
      ...manifest.pages[0],
      markdownFilePath: "%2e%2e/secret.md",
    };
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response("# Secret");
    }) as typeof fetch;
    try {
      const response = await createDocsProxy({
        manifest,
        publicPathPrefix: "/_leadtype",
      })(new Request("https://example.com/docs/quickstart.md"));
      expect(response.status).toBe(500);
      expect(fetchCalls).toBe(0);
      expect(await response.text()).toContain(
        "# Markdown temporarily unavailable"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports a Next proxy markdown fetch failure as a server error", async () => {
    // `/docs/quickstart` is in the manifest, so an unreachable mirror is a
    // broken deployment — not a page that stopped existing.
    const manifest = buildManifest();
    const originalFetch = globalThis.fetch;
    const fetchError = new TypeError("network failure");
    let reportedError: unknown;
    globalThis.fetch = (async () => {
      throw fetchError;
    }) as typeof fetch;
    try {
      const response = await createDocsProxy({
        manifest,
        onReadError: (_target, cause) => {
          reportedError = cause;
        },
      })(new Request("https://example.com/docs/quickstart.md"));
      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Type")).toContain("text/markdown");
      expect(reportedError).toBe(fetchError);
      const body = await response.text();
      expect(body).toContain("# Markdown temporarily unavailable");
      expect(body).not.toContain("# Page not found");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects successful HTML fallbacks when fetching a markdown mirror", async () => {
    const manifest = buildManifest();
    const originalFetch = globalThis.fetch;
    let reportedError: unknown;
    globalThis.fetch = (async () =>
      new Response("<html><body>Fallback</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as typeof fetch;
    try {
      const response = await createDocsProxy({
        manifest,
        onReadError: (_target, cause) => {
          reportedError = cause;
        },
      })(new Request("https://example.com/docs/quickstart.md"));
      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(reportedError).toBeInstanceOf(Error);
      expect((reportedError as Error).message).toContain(
        "unexpected content type"
      );
      const body = await response.text();
      expect(body).toContain("# Markdown temporarily unavailable");
      expect(body).not.toContain("Fallback");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports markdown reader failures through framework handlers", async () => {
    const manifest = buildManifest();
    const readError = new Error("asset unavailable");
    let reportedError: unknown;
    let reportedFilePath: string | undefined;
    const response = await createTanStackServerHandler({
      manifest,
      readMarkdownFile: () => Promise.reject(readError),
      onReadError: (target, cause) => {
        reportedError = cause;
        reportedFilePath = target.filePath;
      },
    })(new Request("https://example.com/docs/quickstart.md"));

    expect(response.status).toBe(500);
    expect(reportedError).toBe(readError);
    expect(reportedFilePath).toBe("docs/quickstart.md");
  });

  it("keeps unknown adapter routes on the recovery body, or 404s on request", async () => {
    const manifest = buildManifest();
    const unknown = new Request("https://example.com/docs/nope.md");

    // Documented Vercel-compatible default: the agent gets the recovery body.
    const soft = await createTanStackServerHandler({
      manifest,
      readMarkdownFile: () => null,
    })(unknown);
    expect(soft.status).toBe(200);
    expect(await soft.text()).toContain("# Page not found");

    // Sites that want dead-link detection opt in through the adapter config.
    const hard = await createRequiredNitroDocsHandler({
      manifest,
      readMarkdownFile: () => null,
      missingStatus: 404,
    })({ request: unknown });
    expect(hard.status).toBe(404);
    expect(await hard.text()).toContain("# Page not found");
  });
});
