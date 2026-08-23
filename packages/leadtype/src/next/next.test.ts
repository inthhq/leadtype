import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentReadabilityManifest } from "../llm/readability";
import {
  createDocsProxy,
  createDocsRouteHandler,
  createGenerateMetadata,
  createGenerateStaticParams,
  createLoadPageData,
} from "./index";

function buildManifest(): AgentReadabilityManifest {
  return {
    version: 1,
    generatedAt: "2026-05-13T00:00:00.000Z",
    baseUrl: "https://example.com",
    product: { name: "Test", summary: "" },
    pages: [
      {
        title: "Getting Started",
        description: "",
        urlPath: "/docs/getting-started",
        absoluteUrl: "https://example.com/docs/getting-started",
        markdownUrlPath: "/docs/getting-started.md",
        markdownAbsoluteUrl: "https://example.com/docs/getting-started.md",
        relativePath: "getting-started",
        groups: [],
        lastModified: "2026-05-13T00:00:00.000Z",
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

describe("createDocsRouteHandler", () => {
  let publicDir: string;

  beforeEach(async () => {
    publicDir = await mkdtemp(path.join(tmpdir(), "leadtype-next-"));
    await mkdir(path.join(publicDir, "docs"), { recursive: true });
    await writeFile(
      path.join(publicDir, "docs", "getting-started.md"),
      "# Getting Started\n\nHello from markdown.\n",
      "utf8"
    );
  });

  afterEach(async () => {
    // Tmp dirs from `mkdtemp` are auto-collected on macOS; rely on that to
    // avoid platform-specific cleanup logic in tests.
  });

  it("serves markdown for an explicit .md request", async () => {
    const handler = createDocsRouteHandler({
      manifest: buildManifest(),
      publicDir,
    });
    const response = await handler(
      new Request("https://example.com/docs/getting-started.md")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    const body = await response.text();
    expect(body).toContain("Getting Started");
    expect(body).toContain("Hello from markdown.");
  });

  it("serves markdown when Accept: text/markdown is set", async () => {
    const handler = createDocsRouteHandler({
      manifest: buildManifest(),
      publicDir,
    });
    const response = await handler(
      new Request("https://example.com/docs/getting-started", {
        headers: { Accept: "text/markdown" },
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
  });

  it("returns 404 for unknown HTML paths", async () => {
    const handler = createDocsRouteHandler({
      manifest: buildManifest(),
      publicDir,
    });
    const response = await handler(
      new Request("https://example.com/docs/nope", {
        headers: { Accept: "text/html" },
      })
    );
    expect(response.status).toBe(404);
  });

  it("keeps the 200 recovery body for unknown .md paths", async () => {
    const handler = createDocsRouteHandler({
      manifest: buildManifest(),
      publicDir,
    });
    const response = await handler(
      new Request("https://example.com/docs/nope.md")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    const body = await response.text();
    expect(body).toContain("Page not found");
  });

  it("honors missingStatus on the route handler and the proxy", async () => {
    const manifest = buildManifest();
    const unknown = "https://example.com/docs/nope.md";

    const route = await createDocsRouteHandler({
      manifest,
      publicDir,
      missingStatus: 404,
    })(new Request(unknown));
    expect(route.status).toBe(404);
    expect(await route.text()).toContain("Page not found");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 404 })) as typeof fetch;
    try {
      const proxied = await createDocsProxy({ manifest, missingStatus: 404 })(
        new Request(unknown)
      );
      expect(proxied.status).toBe(404);
      expect(proxied.headers.get("content-type")).toContain("text/markdown");
      expect(await proxied.text()).toContain("Page not found");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects declared non-Markdown proxy assets", async () => {
    const manifest = buildManifest();
    const proxy = createDocsProxy({ manifest });
    const request = new Request("https://example.com/docs/getting-started.md");
    const originalFetch = globalThis.fetch;
    try {
      for (const contentType of [
        "application/json",
        "image/png",
        "text/html",
        "application/xhtml+xml",
      ]) {
        globalThis.fetch = (async () =>
          new Response("not markdown", {
            headers: { "content-type": contentType },
          })) as typeof fetch;
        const response = await proxy(request);
        expect(response.status).toBe(500);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.text()).toContain(
          "# Markdown temporarily unavailable"
        );
      }

      for (const contentType of [
        "application/octet-stream",
        "text/markdown; charset=utf-8",
        "text/plain; charset=utf-8",
        "text/x-markdown; charset=utf-8",
        null,
      ]) {
        globalThis.fetch = (async () =>
          contentType
            ? new Response("# Mirror\n", {
                headers: { "content-type": contentType },
              })
            : new Response(
                new TextEncoder().encode("# Mirror\n")
              )) as typeof fetch;
        const response = await proxy(request);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("# Mirror");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports a manifest page with no file on disk as a server error", async () => {
    const base = buildManifest();
    const handler = createDocsRouteHandler({
      manifest: {
        ...base,
        pages: [
          ...base.pages,
          {
            title: "Deleted Mirror",
            description: "",
            urlPath: "/docs/deleted-mirror",
            absoluteUrl: "https://example.com/docs/deleted-mirror",
            markdownUrlPath: "/docs/deleted-mirror.md",
            markdownAbsoluteUrl: "https://example.com/docs/deleted-mirror.md",
            relativePath: "deleted-mirror",
            groups: [],
            lastModified: "2026-05-13T00:00:00.000Z",
          },
        ],
      },
      publicDir,
    });

    // The public reader turns ENOENT into null; because the manifest lists the
    // page, that is a broken build rather than a missing page.
    const response = await handler(
      new Request("https://example.com/docs/deleted-mirror.md")
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toContain(
      "# Markdown temporarily unavailable"
    );
  });

  it("serves the API catalog well-known route for a manifest with APIs", async () => {
    const handler = createDocsRouteHandler({
      manifest: {
        ...buildManifest(),
        files: {
          ...buildManifest().files,
          apiCatalog: "/.well-known/api-catalog",
        },
        apis: [{ href: "/ask", title: "Documentation query API" }],
      },
      publicDir,
    });
    const response = await handler(
      new Request("https://example.com/.well-known/api-catalog")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
    );
    expect(response.headers.get("Link")).toContain('rel="api-catalog"');
    const body = await response.json();
    expect(body.linkset[0].item[0].href).toBe("https://example.com/ask");

    const head = await handler(
      new Request("https://example.com/.well-known/api-catalog", {
        method: "HEAD",
      })
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("Link")).toContain('rel="api-catalog"');
    expect(await head.text()).toBe("");
  });

  it("404s the API catalog route when no APIs are configured", async () => {
    const handler = createDocsRouteHandler({
      manifest: buildManifest(),
      publicDir,
    });
    const response = await handler(
      new Request("https://example.com/.well-known/api-catalog")
    );
    expect(response.status).toBe(404);
  });

  it("routes through a custom readMarkdownFile when provided", async () => {
    const handler = createDocsRouteHandler({
      manifest: buildManifest(),
      readMarkdownFile: () => "custom body",
    });
    const response = await handler(
      new Request("https://example.com/docs/getting-started.md")
    );
    expect(await response.text()).toContain("custom body");
  });
});

describe("createGenerateStaticParams / createLoadPageData", () => {
  it("returns the slug list and resolves pages", async () => {
    const stubSource = {
      contentDir: "/stub",
      listPages: async () => [
        {
          slug: ["a"],
          urlPath: "/docs/a",
          relativePath: "a",
          extension: ".mdx" as const,
          filePath: "/stub/a.mdx",
          title: "A",
          description: "",
          groups: [],
        },
        {
          slug: ["b", "c"],
          urlPath: "/docs/b/c",
          relativePath: "b/c",
          extension: ".md" as const,
          filePath: "/stub/b/c.md",
          title: "C",
          description: "",
          groups: [],
        },
      ],
      loadPage: async (slug: string | string[]) => {
        const key = Array.isArray(slug) ? slug.join("/") : slug;
        if (key === "a") {
          return {
            slug: ["a"],
            urlPath: "/docs/a",
            relativePath: "a",
            extension: ".mdx" as const,
            filePath: "/stub/a.mdx",
            title: "A",
            description: "",
            groups: [],
            frontmatter: {},
            markdown: "# A",
            ast: { type: "root", children: [] } as never,
            toc: [],
          };
        }
        return null;
      },
      getNavigation: async () => ({
        groups: [],
        ungrouped: [],
        unknown: [],
      }),
      buildSearchIndex: () => {
        throw new Error("not used");
      },
      resolveInclude: () => {
        throw new Error("not used");
      },
    } as never;

    const generateStaticParams = createGenerateStaticParams({
      source: stubSource,
    });
    expect(await generateStaticParams()).toEqual([
      { slug: ["a"] },
      { slug: ["b", "c"] },
    ]);

    const loadPageData = createLoadPageData({ source: stubSource });
    const page = await loadPageData(["a"]);
    expect(page?.title).toBe("A");
    expect(await loadPageData(["z"])).toBeNull();
    // Falsy slug should also resolve to null (root catch-all without segments).
    expect(await loadPageData(undefined)).toBeNull();
  });
});

describe("createGenerateMetadata", () => {
  it("throws on unsupported manifest version", async () => {
    const manifest = {
      ...buildManifest(),
      version: 2,
    } as unknown as AgentReadabilityManifest;
    const generateMetadata = createGenerateMetadata({ manifest });

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: ["getting-started"] }),
      })
    ).rejects.toThrow(/manifest version 2/);
  });

  it("returns Next metadata for known docs pages", async () => {
    const generateMetadata = createGenerateMetadata({
      manifest: buildManifest(),
    });

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: ["getting-started"] }),
      })
    ).resolves.toEqual({
      title: "Getting Started | Test",
      description: "Getting Started documentation for Test.",
      alternates: {
        canonical: "https://example.com/docs/getting-started",
        types: {
          "text/markdown": "https://example.com/docs/getting-started.md",
        },
      },
      openGraph: {
        title: "Getting Started | Test",
        description: "Getting Started documentation for Test.",
        url: "https://example.com/docs/getting-started",
        type: "article",
      },
    });
  });

  it("returns an empty metadata object for unknown docs pages", async () => {
    const generateMetadata = createGenerateMetadata({
      manifest: buildManifest(),
    });

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: ["missing"] }) })
    ).resolves.toEqual({});
  });

  it("supports metadata and route overrides", async () => {
    const generateMetadata = createGenerateMetadata({
      manifest: buildManifest(),
      resolveUrlPath: () => "/docs/getting-started",
      title: ({ page }) => `${page.title} - Custom`,
      description: "Custom description.",
      openGraph: ({ page }) => ({
        title: page.title,
        description: page.description || "Custom description.",
        url: page.absoluteUrl,
        type: "article",
        images: ["https://example.com/og.png"],
      }),
      metadata: {
        alternates: {
          types: {
            "application/rss+xml": "https://example.com/docs/rss.xml",
          },
        },
        openGraph: {
          siteName: "Example Docs",
        },
        robots: { index: true, follow: true },
      },
    });

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: ["anything"] }) })
    ).resolves.toMatchObject({
      title: "Getting Started - Custom",
      description: "Custom description.",
      alternates: {
        canonical: "https://example.com/docs/getting-started",
        types: {
          "text/markdown": "https://example.com/docs/getting-started.md",
          "application/rss+xml": "https://example.com/docs/rss.xml",
        },
      },
      openGraph: {
        title: "Getting Started",
        images: ["https://example.com/og.png"],
        siteName: "Example Docs",
      },
      robots: { index: true, follow: true },
    });
  });

  it("cascades title and description overrides to OpenGraph defaults", async () => {
    const generateMetadata = createGenerateMetadata({
      manifest: buildManifest(),
      title: "Custom title",
      description: ({ page }) => `${page.title} custom description.`,
    });

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: ["getting-started"] }),
      })
    ).resolves.toMatchObject({
      title: "Custom title",
      description: "Getting Started custom description.",
      openGraph: {
        title: "Custom title",
        description: "Getting Started custom description.",
      },
    });
  });

  it("lets explicit OpenGraph overrides win over cascaded metadata", async () => {
    const generateMetadata = createGenerateMetadata({
      manifest: buildManifest(),
      title: "Custom title",
      description: "Custom description.",
      openGraph: {
        title: "Social title",
        description: "Social description.",
      },
    });

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: ["getting-started"] }),
      })
    ).resolves.toMatchObject({
      title: "Custom title",
      description: "Custom description.",
      openGraph: {
        title: "Social title",
        description: "Social description.",
      },
    });
  });
});
