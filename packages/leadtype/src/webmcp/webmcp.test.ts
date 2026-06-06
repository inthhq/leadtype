import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDocsSearchIndex,
  type DocsSearchDocument,
} from "../search/index";
import {
  createDocsWebMcpTools,
  registerWebMcpTools,
  type WebMcpTool,
} from "./index";

const docs: DocsSearchDocument[] = [
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
    urlPath: "/docs/authoring/components",
    absoluteUrl: "https://leadtype.dev/docs/authoring/components",
    relativePath: "authoring/components",
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
});
