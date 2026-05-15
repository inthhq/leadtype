import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDocsSearchIndex,
  type DocsSearchBundle,
  type DocsSearchDocument,
} from "../search/search";
import { createSearchClient } from "./client";

function buildSearchBundle(): DocsSearchBundle {
  const docs: DocsSearchDocument[] = [
    {
      id: "/docs/quickstart",
      title: "Quickstart",
      description: "Five-minute happy path.",
      urlPath: "/docs/quickstart",
      absoluteUrl: "https://example.com/docs/quickstart",
      relativePath: "quickstart",
      content: "# Quickstart\n\nBuild your first leadtype docs site here.",
    },
    {
      id: "/docs/install",
      title: "Install",
      description: "Install the package.",
      urlPath: "/docs/install",
      absoluteUrl: "https://example.com/docs/install",
      relativePath: "install",
      content: "# Install\n\nUse bun add leadtype to install the package.",
    },
  ];
  const index = createDocsSearchIndex(docs);
  return {
    index,
    content: index.content ?? {
      version: index.version,
      generatedAt: index.generatedAt,
      chunks: [],
    },
  };
}

// Module-level cache in client.ts persists across tests; reset by passing
// distinct URLs per test case so cache keys don't collide.
let testCounter = 0;
function nextScope(): {
  indexUrl: string;
  contentUrl: string;
} {
  testCounter += 1;
  return {
    indexUrl: `/test-${testCounter}/search-index.json`,
    contentUrl: `/test-${testCounter}/search-content.json`,
  };
}

describe("createSearchClient", () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns no results for empty queries without fetching", async () => {
    let calls = 0;
    const fetchImpl = () => {
      calls += 1;
      return Promise.resolve(new Response("{}"));
    };
    const client = createSearchClient("docs", {
      ...nextScope(),
      fetch: fetchImpl as typeof fetch,
    });
    expect(await client.search("")).toEqual([]);
    expect(await client.search("   ")).toEqual([]);
    expect(calls).toBe(0);
  });

  it("loads artifacts and returns BM25 results", async () => {
    const bundle = buildSearchBundle();
    const scope = nextScope();
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith(scope.indexUrl)) {
        return Promise.resolve(Response.json(bundle.index));
      }
      if (url.endsWith(scope.contentUrl)) {
        return Promise.resolve(Response.json(bundle.content));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as typeof fetch;

    const client = createSearchClient("docs", {
      indexUrl: scope.indexUrl,
      contentUrl: scope.contentUrl,
      fetch: fetchImpl,
    });
    const results = await client.search("install");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toBe("Install");
  });

  it("treats a missing content file as a soft failure", async () => {
    const bundle = buildSearchBundle();
    const scope = nextScope();
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith(scope.indexUrl)) {
        return Promise.resolve(Response.json(bundle.index));
      }
      // Content file 404s — BM25 index should still work.
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as typeof fetch;

    const client = createSearchClient("docs", {
      indexUrl: scope.indexUrl,
      contentUrl: scope.contentUrl,
      fetch: fetchImpl,
    });
    const results = await client.search("quickstart");
    expect(results.length).toBeGreaterThan(0);
  });

  it("surfaces an error when the index fetch fails", async () => {
    const scope = nextScope();
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(null, { status: 500, statusText: "Server Error" })
      )) as typeof fetch;
    const client = createSearchClient("docs", {
      ...scope,
      fetch: fetchImpl,
    });
    await expect(client.search("hello")).rejects.toThrow(
      /failed to fetch.*500/
    );
  });

  it("preload() prefetches without running a query", async () => {
    const bundle = buildSearchBundle();
    const scope = nextScope();
    let indexHits = 0;
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith(scope.indexUrl)) {
        indexHits += 1;
        return Promise.resolve(Response.json(bundle.index));
      }
      return Promise.resolve(Response.json(bundle.content));
    }) as typeof fetch;
    const client = createSearchClient("docs", {
      ...scope,
      fetch: fetchImpl,
    });
    await client.preload();
    expect(indexHits).toBe(1);
    // Subsequent search() shouldn't refetch the index — module-level cache.
    await client.search("install");
    expect(indexHits).toBe(1);
  });
});
