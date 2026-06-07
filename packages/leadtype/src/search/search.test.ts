import { describe, expect, it } from "vitest";
import {
  attachDocsSearchContent,
  createAnswerContext,
  createDocsSearchIndex,
  createMemoryRateLimiter,
  type DocsSearchDocument,
  DocsSearchRequestError,
  getClientIdentifier,
  listDocsContentFiles,
  readDocsContentChunk,
  readDocsContentFile,
  readJsonWithLimit,
  searchDocs,
  slugifyDocsHeading,
  validateDocsQuery,
} from "./index";

const docs: DocsSearchDocument[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    description: "Install and configure the package.",
    urlPath: "/docs/guides/quickstart",
    absoluteUrl: "https://leadtype.dev/docs/guides/quickstart",
    relativePath: "guides/quickstart",
    content: `---
title: Quickstart
---

# Quickstart

Install the package.

## CommandTabs

Use tabs to switch between npm, pnpm, and bun install commands.
`,
  },
  {
    id: "tabs",
    title: "Tabs",
    description: "Interactive tab controls.",
    urlPath: "/docs/components/tabs",
    absoluteUrl: "https://leadtype.dev/docs/components/tabs",
    relativePath: "components/tabs",
    content: `# Components

## Keyboard Navigation

Panels can be changed with arrow keys.
`,
  },
  {
    id: "body-only",
    title: "Components",
    description: "General component details.",
    urlPath: "/docs/components",
    absoluteUrl: "https://leadtype.dev/docs/components",
    relativePath: "components",
    content: `# Components

This page mentions tabs in body copy only.
`,
  },
  {
    id: "code",
    title: "Code",
    description: "Code examples.",
    urlPath: "/docs/code",
    absoluteUrl: "https://leadtype.dev/docs/code",
    relativePath: "code",
    content: `# Code

\`\`\`ts
const cafe = "café";
\`\`\`
`,
  },
];

describe("createDocsSearchIndex and searchDocs", () => {
  it("stores compact metadata separately from answer content", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(index.version).toBe(2);
    expect(index.documents[0]).toEqual([
      "quickstart",
      "Quickstart",
      "Install and configure the package.",
      "/docs/guides/quickstart",
      "https://leadtype.dev/docs/guides/quickstart",
      "guides/quickstart",
    ]);
    expect(index.chunks[0]).toHaveLength(6);
    expect(index.chunks[0]).not.toHaveProperty("text");
    expect(index.content?.version).toBe(2);
    expect(index.content?.chunks[0]).toContain("Install the package");
  });

  it("normalizes case, punctuation, and diacritics", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const results = searchDocs(index, "CAFÉ!!!");

    expect(results[0]?.title).toBe("Code");
  });

  it("expands queries with synonyms while keeping exact matches first", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const results = searchDocs(index, "setup package");

    expect(results[0]?.title).toBe("Quickstart");
    expect(results[0]?.excerpt).toContain("Install");
  });

  it("supports custom synonyms at query time", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const results = searchDocs(index, "switcher", {
      synonyms: { switcher: ["keyboard"] },
    });

    expect(results[0]?.title).toBe("Tabs");
  });

  it("lets transformers customize search documents and chunks", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      transformers: [
        {
          name: "search-metadata",
          beforeSearchIndex(documents) {
            return documents.map((doc) => ({
              ...doc,
              description:
                doc.id === "quickstart"
                  ? `${doc.description} sdk bootstrap`
                  : doc.description,
            }));
          },
          beforeSearchChunk(chunk) {
            if (chunk.relativePath !== "guides/quickstart") {
              return;
            }
            return {
              ...chunk,
              text: `${chunk.text}\n\napiArea: onboarding`,
            };
          },
        },
      ],
    });

    expect(searchDocs(index, "bootstrap")[0]?.documentId).toBe("quickstart");
    expect(searchDocs(index, "onboarding")[0]?.documentId).toBe("quickstart");
  });

  it("does not index shared route documents by default", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "shared-script-loader",
          title: "Script loader",
          urlPath: "/docs/shared/react/guides/script-loader",
          absoluteUrl:
            "https://leadtype.dev/docs/shared/react/guides/script-loader",
          relativePath: "shared/react/guides/script-loader",
          content: "# Script loader\n\nAlways load the shared script.",
        },
        {
          id: "underscore-shared-script-loader",
          title: "Script loader",
          urlPath: "/docs/_shared/react/guides/script-loader",
          absoluteUrl:
            "https://leadtype.dev/docs/_shared/react/guides/script-loader",
          relativePath: "_shared/react/guides/script-loader",
          content: "# Script loader\n\nAlways load the _shared script.",
        },
        {
          id: "changelog-shared-template",
          title: "Release template",
          urlPath: "/changelog/_shared/release-template",
          absoluteUrl:
            "https://leadtype.dev/changelog/_shared/release-template",
          relativePath: "changelog/_shared/release-template",
          content: "# Release template\n\nShared changelog release notes.",
        },
        {
          id: "react-script-loader",
          title: "Script loader",
          urlPath: "/docs/frameworks/react/script-loader",
          absoluteUrl:
            "https://leadtype.dev/docs/frameworks/react/script-loader",
          relativePath: "frameworks/react/script-loader",
          content: "# Script loader\n\nAlways load the shared script.",
        },
      ],
      {
        generatedAt: "2026-01-01T00:00:00.000Z",
      }
    );

    expect(index.documents.map((document) => document[3])).toEqual([
      "/docs/frameworks/react/script-loader",
    ]);
    expect(searchDocs(index, "always load")).toHaveLength(1);
  });

  it("lets frontmatter opt shared routes into search", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "shared-public",
          title: "Shared public guide",
          urlPath: "/docs/shared/public-guide",
          absoluteUrl: "https://leadtype.dev/docs/shared/public-guide",
          relativePath: "shared/public-guide",
          frontmatter: { search: true },
          content: "# Shared public guide\n\nReusable concepts.",
        },
      ],
      {
        generatedAt: "2026-01-01T00:00:00.000Z",
      }
    );

    expect(index.documents[0]?.[3]).toBe("/docs/shared/public-guide");
    expect(searchDocs(index, "reusable")[0]?.urlPath).toBe(
      "/docs/shared/public-guide"
    );
  });

  it("lets frontmatter exclude public docs from search", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "private-preview",
          title: "Private preview",
          urlPath: "/docs/private-preview",
          absoluteUrl: "https://leadtype.dev/docs/private-preview",
          relativePath: "private-preview",
          frontmatter: { search: false },
          content: "# Private preview\n\nUnreleased preview details.",
        },
      ],
      {
        generatedAt: "2026-01-01T00:00:00.000Z",
      }
    );

    expect(index.documents).toEqual([]);
    expect(searchDocs(index, "unreleased")).toEqual([]);
  });

  it("falls back to prefix and typo-tolerant matches", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(searchDocs(index, "keyb")[0]?.title).toBe("Tabs");
    expect(searchDocs(index, "caff")[0]?.title).toBe("Code");
  });

  it("boosts phrase matches when content is available", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "phrase",
          title: "Guide",
          urlPath: "/docs/phrase",
          absoluteUrl: "https://leadtype.dev/docs/phrase",
          relativePath: "phrase",
          content: "# Guide\n\nInstall the package with the CLI.",
        },
        {
          id: "split",
          title: "Guide",
          urlPath: "/docs/split",
          absoluteUrl: "https://leadtype.dev/docs/split",
          relativePath: "split",
          content:
            "# Guide\n\nInstall the tool first. The package manager comes later.",
        },
      ],
      {
        generatedAt: "2026-01-01T00:00:00.000Z",
      }
    );

    expect(searchDocs(index, "install package")[0]?.urlPath).toBe(
      "/docs/phrase"
    );
  });

  it("preserves heading paths in chunks and results", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = searchDocs(index, "pnpm")[0];

    expect(result?.headingPath).toEqual(["Quickstart", "CommandTabs"]);
  });

  it("adds hash URLs for the matched heading", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = searchDocs(index, "pnpm")[0];

    expect(result?.anchor).toBe("commandtabs");
    expect(result?.urlWithHash).toBe("/docs/guides/quickstart#commandtabs");
    expect(result?.absoluteUrlWithHash).toBe(
      "https://leadtype.dev/docs/guides/quickstart#commandtabs"
    );
  });

  it("slugifies headings for hash links", () => {
    expect(slugifyDocsHeading("Café API: Quick Start!")).toBe(
      "cafe-api-quick-start"
    );
  });

  it("ranks title and heading matches above body-only matches", () => {
    const rankingDocs: DocsSearchDocument[] = [
      {
        id: "title",
        title: "Tabs",
        urlPath: "/docs/title",
        absoluteUrl: "https://leadtype.dev/docs/title",
        relativePath: "title",
        content: "# Overview\n\nShort body.",
      },
      {
        id: "heading",
        title: "Guide",
        urlPath: "/docs/heading",
        absoluteUrl: "https://leadtype.dev/docs/heading",
        relativePath: "heading",
        content: "# Guide\n\n## Tabs\n\nShort body.",
      },
      {
        id: "body",
        title: "Guide",
        urlPath: "/docs/body",
        absoluteUrl: "https://leadtype.dev/docs/body",
        relativePath: "body",
        content: "# Guide\n\nThis page mentions tabs in body copy only.",
      },
    ];
    const index = createDocsSearchIndex(rankingDocs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const results = searchDocs(index, "tabs");
    const headingIndex = results.findIndex(
      (result) => result.urlPath === "/docs/heading"
    );
    const bodyOnlyIndex = results.findIndex(
      (result) => result.urlPath === "/docs/body"
    );

    expect(results[0]?.title).toBe("Tabs");
    expect(headingIndex).toBeGreaterThan(-1);
    expect(bodyOnlyIndex).toBeGreaterThan(headingIndex);
  });

  it("returns no results for empty or stopword-only queries", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(searchDocs(index, "   ")).toEqual([]);
    expect(searchDocs(index, "the and or")).toEqual([]);
  });

  it("builds excerpts around matching text", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = searchDocs(index, "pnpm")[0];

    expect(result?.excerpt).toContain("pnpm");
  });

  it("searches metadata-only indexes and uses split content for excerpts", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { content, ...metadataOnlyIndex } = index;
    if (!content) {
      throw new Error("Expected createDocsSearchIndex to embed content.");
    }

    expect(searchDocs(metadataOnlyIndex, "pnpm")[0]?.title).toBe("Quickstart");
    expect(searchDocs(metadataOnlyIndex, "pnpm")[0]?.excerpt).toContain(
      "CommandTabs"
    );
    expect(
      searchDocs(metadataOnlyIndex, "pnpm", { content })[0]?.excerpt
    ).toContain("pnpm");
    expect(attachDocsSearchContent(metadataOnlyIndex, content).content).toBe(
      content
    );
  });

  it("reads docs content as files and precise chunks", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = searchDocs(index, "pnpm")[0];
    const file = readDocsContentFile(index, "guides/quickstart");
    const fileByUrl = readDocsContentFile(index, "/docs/guides/quickstart");
    const chunk = result ? readDocsContentChunk(index, result.id) : undefined;

    expect(listDocsContentFiles(index)).toHaveLength(docs.length);
    expect(file?.title).toBe("Quickstart");
    expect(fileByUrl?.title).toBe("Quickstart");
    expect(file?.chunks[0]?.anchor).toBe("quickstart");
    expect(chunk?.absoluteUrlWithHash).toBe(
      "https://leadtype.dev/docs/guides/quickstart#commandtabs"
    );
    expect(chunk?.text).toContain("bun install commands");
  });
});

describe("createAnswerContext", () => {
  it("caps source count and total context characters", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const context = createAnswerContext(index, "tabs", {
      maxSources: 1,
      maxContextChars: 80,
      productName: "leadtype",
    });

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.context.length).toBeLessThanOrEqual(80);
  });

  it("includes citation and prompt-injection guardrails", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const context = createAnswerContext(index, "tabs", {
      productName: "leadtype",
    });

    expect(context.system).toContain(
      "Use only the provided documentation context"
    );
    expect(context.system).toContain("untrusted reference text");
    expect(context.prompt).toContain("[1]");
    expect(context.prompt).toContain("#");
  });

  it("forwards custom search synonyms into source retrieval", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const context = createAnswerContext(index, "switcher", {
      synonyms: { switcher: ["keyboard"] },
    });

    expect(context.sources[0]?.title).toBe("Tabs");
  });
});

describe("request guards", () => {
  it("validates query shape and size", () => {
    expect(validateDocsQuery("  hello   docs  ")).toBe("hello docs");
    expect(() => validateDocsQuery("x".repeat(401))).toThrow(
      DocsSearchRequestError
    );
    expect(() => validateDocsQuery("bad\u0000query")).toThrow(
      DocsSearchRequestError
    );
  });

  it("reads JSON bodies with a byte limit", async () => {
    const request = new Request("https://example.com/api", {
      method: "POST",
      body: JSON.stringify({ query: "tabs" }),
    });

    await expect(
      readJsonWithLimit<{ query: string }>(request)
    ).resolves.toEqual({
      query: "tabs",
    });

    const oversized = new Request("https://example.com/api", {
      method: "POST",
      body: JSON.stringify({ query: "x".repeat(20) }),
    });

    await expect(readJsonWithLimit(oversized, { maxBytes: 8 })).rejects.toThrow(
      DocsSearchRequestError
    );
  });

  it("derives client identifiers from forwarding headers", () => {
    const request = new Request("https://example.com/api", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 198.51.100.4",
      },
    });

    expect(getClientIdentifier(request)).toBe("203.0.113.10");
  });
});

describe("createMemoryRateLimiter", () => {
  it("allows requests until the threshold and then blocks", () => {
    let now = 1000;
    const limiter = createMemoryRateLimiter({
      limit: 2,
      windowMs: 1000,
      now: () => now,
    });

    expect(limiter.check("client").allowed).toBe(true);
    expect(limiter.check("client").allowed).toBe(true);
    expect(limiter.check("client").allowed).toBe(false);

    now = 2500;
    expect(limiter.check("client").allowed).toBe(true);
  });
});
