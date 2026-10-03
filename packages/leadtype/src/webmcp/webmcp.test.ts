import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDocsSearchIndex,
  type DocsSearchDocument,
} from "../search/index";
import {
  createDocsWebMcpTools,
  registerDocsWebMcpTools,
  registerWebMcpTools,
  type WebMcpTool,
} from "./index";

const docs: DocsSearchDocument[] = [
  {
    id: "index",
    title: "Docs",
    description: "Leadtype documentation.",
    urlPath: "/docs",
    absoluteUrl: "https://leadtype.dev/docs",
    relativePath: "index",
    content: "# Docs\n\nWelcome to the documentation.",
  },
  {
    id: "quickstart",
    title: "Quickstart",
    description: "Install and configure Leadtype.",
    urlPath: "/docs/quickstart",
    absoluteUrl: "https://leadtype.dev/docs/quickstart",
    relativePath: "quickstart",
    content: "# Quickstart\n\nInstall Leadtype and generate docs.",
  },
  {
    id: "components",
    title: "Components",
    description: "Render MDX components.",
    urlPath: "/docs/writing/components",
    absoluteUrl: "https://leadtype.dev/docs/writing/components",
    relativePath: "writing/components",
    content: "# Components\n\nUse CommandTabs and TypeTable in MDX.",
  },
];

function createModelContext() {
  const registrations: Array<{
    options?: { signal?: AbortSignal };
    tool: WebMcpTool;
  }> = [];
  return {
    context: {
      registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => {
        registrations.push({ options, tool });
      },
    },
    registrations,
  };
}

function jsonResponse(value: unknown): Response {
  return Response.json(value);
}

type StubbedGlobalName = "document" | "navigator";

const stubbedGlobals: Array<{
  descriptor: PropertyDescriptor | undefined;
  name: StubbedGlobalName;
}> = [];

function stubGlobal(name: StubbedGlobalName, value: unknown): void {
  stubbedGlobals.push({
    descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
    name,
  });
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
}

afterEach(() => {
  for (const { descriptor, name } of stubbedGlobals.reverse()) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as Record<StubbedGlobalName, unknown>)[name];
    }
  }
  stubbedGlobals.length = 0;
});

describe("registerWebMcpTools", () => {
  it("registers tools through document.modelContext and unregisters by aborting", () => {
    const { context, registrations } = createModelContext();
    stubGlobal("document", { modelContext: context });

    const result = registerWebMcpTools([
      {
        name: "search-docs",
        description: "Search docs.",
        execute: () => [],
      },
    ]);

    expect(result.supported).toBe(true);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.options?.signal?.aborted).toBe(false);

    result.unregister();

    expect(registrations[0]?.options?.signal?.aborted).toBe(true);
  });

  it("falls back to navigator.modelContext", () => {
    const { context, registrations } = createModelContext();
    stubGlobal("navigator", { modelContext: context });

    const result = registerWebMcpTools([
      {
        name: "get-page",
        description: "Get a page.",
        execute: () => "",
      },
    ]);

    expect(result.supported).toBe(true);
    expect(registrations.map((entry) => entry.tool.name)).toEqual(["get-page"]);
  });

  it("returns a no-op result when WebMCP is unavailable", () => {
    const result = registerWebMcpTools([
      {
        name: "get-page",
        description: "Get a page.",
        execute: () => "",
      },
    ]);

    expect(result.supported).toBe(false);
    expect(() => result.unregister()).not.toThrow();
  });

  it("rejects invalid tool definitions before registering", () => {
    const { context, registrations } = createModelContext();

    expect(() =>
      registerWebMcpTools(
        [
          {
            name: "bad name",
            description: "Bad.",
            execute: () => "",
          },
        ],
        { modelContext: context }
      )
    ).toThrow(/invalid tool name/);
    expect(registrations).toHaveLength(0);
  });

  it("rejects invalid tool definitions even when WebMCP is unavailable", () => {
    expect(() =>
      registerWebMcpTools([
        {
          name: "bad name",
          description: "Bad.",
          execute: () => "",
        },
      ])
    ).toThrow(/invalid tool name/);
  });

  it("rolls back earlier registrations when a later registerTool throws", () => {
    const { registrations } = createModelContext();
    const failingContext = {
      registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => {
        if (registrations.length === 1) {
          throw new Error("InvalidStateError: duplicate tool name");
        }
        registrations.push({ options, tool });
      },
    };

    expect(() =>
      registerWebMcpTools(
        [
          { name: "first", description: "First.", execute: () => "" },
          { name: "second", description: "Second.", execute: () => "" },
        ],
        { modelContext: failingContext }
      )
    ).toThrow(/duplicate tool name/);
    expect(registrations[0]?.options?.signal?.aborted).toBe(true);
  });
});

describe("createDocsWebMcpTools", () => {
  it("searches generated docs artifacts and fetches markdown pages", async () => {
    const index = createDocsSearchIndex(docs);
    const markdown = "# Quickstart\n\nInstall Leadtype.";
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "/docs/search-index.json") {
        return jsonResponse(index);
      }
      if (href === "/docs/search-content.json" && index.content) {
        return jsonResponse(index.content);
      }
      if (href === "/docs/quickstart.md") {
        return new Response(markdown);
      }
      return new Response("not found", {
        status: 404,
        statusText: "Not Found",
      });
    });
    const tools = createDocsWebMcpTools({ fetch: fetchMock });
    const search = tools.find((tool) => tool.name === "search-docs");
    const getPage = tools.find((tool) => tool.name === "get-page");

    const hits = (await search?.execute(
      { query: "install", limit: 1 },
      {}
    )) as Array<{ urlPath: string }>;
    expect(hits).toHaveLength(1);
    expect(hits[0]?.urlPath).toBe("/docs/quickstart");

    const page = await getPage?.execute(
      { urlPath: hits[0]?.urlPath ?? "" },
      {}
    );
    expect(page).toBe(markdown);
    expect(search?.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("normalizes the docs index page markdown URL", async () => {
    const index = createDocsSearchIndex(docs);
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "/docs/search-index.json") {
        return jsonResponse(index);
      }
      if (href === "/docs/search-content.json" && index.content) {
        return jsonResponse(index.content);
      }
      if (href === "/docs/index.md") {
        return new Response("# Docs");
      }
      return new Response("not found", { status: 404 });
    });
    const getPage = createDocsWebMcpTools({ fetch: fetchMock }).find(
      (tool) => tool.name === "get-page"
    );

    await expect(getPage?.execute({ urlPath: "/docs" }, {})).resolves.toBe(
      "# Docs"
    );
  });

  it("rejects urlPaths that escape the site's own URL space", async () => {
    const index = createDocsSearchIndex(docs);
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "/docs/search-index.json") {
        return jsonResponse(index);
      }
      if (href === "/docs/search-content.json" && index.content) {
        return jsonResponse(index.content);
      }
      return new Response("owned", { status: 200 });
    });
    const getPage = createDocsWebMcpTools({ fetch: fetchMock }).find(
      (tool) => tool.name === "get-page"
    );

    const hostileInputs = [
      "//evil.example/exfil",
      "/\\evil.example/exfil",
      "/docs/../private",
      "/docs/page?x=1",
      "/docs/page#frag",
    ];
    for (const urlPath of hostileInputs) {
      await expect(getPage?.execute({ urlPath }, {})).rejects.toThrow(
        /invalid urlPath/
      );
    }
    // Only the search artifacts may have been fetched — never the hostile URL.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toMatch(/^\/docs\/search-/);
    }
  });

  it("rejects pages that are not in the search index with a search hint", async () => {
    const index = createDocsSearchIndex(docs);
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "/docs/search-index.json") {
        return jsonResponse(index);
      }
      if (href === "/docs/search-content.json" && index.content) {
        return jsonResponse(index.content);
      }
      return new Response("# Secret", { status: 200 });
    });
    const getPage = createDocsWebMcpTools({ fetch: fetchMock }).find(
      (tool) => tool.name === "get-page"
    );

    await expect(
      getPage?.execute({ urlPath: "/docs/not-a-page" }, {})
    ).rejects.toThrow(/Call search-docs/);
  });

  it("fails open to syntactic validation when the index is unreachable", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "/docs/quickstart.md") {
        return new Response("# Quickstart");
      }
      return new Response("not found", { status: 404 });
    });
    // Distinct artifact URLs sidestep the module-level artifact cache shared
    // with the other tests.
    const getPage = createDocsWebMcpTools({
      fetch: fetchMock,
      indexUrl: "/unreachable/search-index.json",
      contentUrl: "/unreachable/search-content.json",
    }).find((tool) => tool.name === "get-page");

    await expect(
      getPage?.execute({ urlPath: "/docs/quickstart" }, {})
    ).resolves.toBe("# Quickstart");
  });

  it("skips index membership checks when validatePages is false", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "/docs/unindexed.md") {
        return new Response("# Unindexed");
      }
      return new Response("not found", { status: 404 });
    });
    const getPage = createDocsWebMcpTools({
      fetch: fetchMock,
      validatePages: false,
    }).find((tool) => tool.name === "get-page");

    await expect(
      getPage?.execute({ urlPath: "/docs/unindexed" }, {})
    ).resolves.toBe("# Unindexed");
    // The index is never consulted.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toMatch(/search-index/);
    }
  });

  it("clamps the search limit and reports non-positive limits", async () => {
    const index = createDocsSearchIndex(docs);
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "/docs/search-index.json") {
        return jsonResponse(index);
      }
      if (href === "/docs/search-content.json" && index.content) {
        return jsonResponse(index.content);
      }
      return new Response("not found", { status: 404 });
    });
    const search = createDocsWebMcpTools({ fetch: fetchMock }).find(
      (tool) => tool.name === "search-docs"
    );

    await expect(
      search?.execute({ query: "docs", limit: 0 }, {})
    ).rejects.toThrow(/positive integer/);
    // An oversized limit is clamped instead of rejected.
    const hits = (await search?.execute(
      { query: "docs", limit: 10_000 },
      {}
    )) as unknown[];
    expect(Array.isArray(hits)).toBe(true);
  });

  it("derives tool names from non-default collections", () => {
    const tools = createDocsWebMcpTools({
      collection: "api-reference",
      fetch: vi.fn(),
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "search-api-reference",
      "get-api-reference-page",
    ]);
    expect(tools[0]?.description).toContain("get-api-reference-page");
  });

  it("rejects unsafe collection ids before building artifact URLs", () => {
    for (const collection of [
      "",
      "   ",
      "/docs",
      "//evil.example",
      "docs/../api",
    ]) {
      expect(() =>
        createDocsWebMcpTools({ collection, fetch: vi.fn() })
      ).toThrow(/collection .* is invalid/);
    }
  });
});

describe("registerDocsWebMcpTools", () => {
  it("creates and registers the docs tools in one call", () => {
    const { context, registrations } = createModelContext();

    const result = registerDocsWebMcpTools({
      fetch: vi.fn(),
      modelContext: context,
    });

    expect(result.supported).toBe(true);
    expect(registrations.map((entry) => entry.tool.name)).toEqual([
      "search-docs",
      "get-page",
    ]);

    result.unregister();
    expect(registrations[0]?.options?.signal?.aborted).toBe(true);
  });
});
