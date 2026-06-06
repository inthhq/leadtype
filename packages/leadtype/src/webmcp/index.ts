import {
  createSearchClient,
  type SearchClientOptions,
} from "../search/client.js";

const DEFAULT_COLLECTION = "docs";
const DEFAULT_SEARCH_LIMIT = 5;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

export type WebMcpJsonSchemaObject = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type WebMcpToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
};

export type WebMcpClient = {
  requestUserInteraction?: (
    callback: (...args: unknown[]) => unknown
  ) => Promise<unknown>;
};

export type WebMcpTool<
  TInput extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: string;
  title?: string;
  description: string;
  inputSchema?: WebMcpJsonSchemaObject;
  annotations?: WebMcpToolAnnotations;
  execute: (input: TInput, client: WebMcpClient) => unknown | Promise<unknown>;
};

export type WebMcpModelContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { exposedTo?: string[]; signal?: AbortSignal }
  ) => void;
};

export type RegisterWebMcpToolsOptions = {
  exposedTo?: string[];
  modelContext?: WebMcpModelContext;
};

export type RegisterWebMcpToolsResult = {
  supported: boolean;
  unregister: () => void;
};

export type DocsWebMcpToolsOptions = SearchClientOptions & {
  collection?: string;
  markdownUrl?: (urlPath: string) => string;
};

type ModelContextHost = {
  modelContext?: WebMcpModelContext;
};

type SearchDocsInput = {
  query: string;
  limit?: number;
};

type GetPageInput = {
  urlPath: string;
};

function readModelContextHost(key: "document" | "navigator"): ModelContextHost {
  const value = (globalThis as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null
    ? (value as ModelContextHost)
    : {};
}

function resolveModelContext(): WebMcpModelContext | undefined {
  return (
    readModelContextHost("document").modelContext ??
    readModelContextHost("navigator").modelContext
  );
}

function validateTool(tool: WebMcpTool): void {
  if (!TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error(
      `leadtype/webmcp: invalid tool name "${tool.name}". Use 1-128 ASCII letters, numbers, "_", "-", or ".".`
    );
  }
  if (tool.description.trim().length === 0) {
    throw new Error(
      `leadtype/webmcp: tool "${tool.name}" must have a non-empty description.`
    );
  }
}

function normalizeUrlPath(value: string): string {
  const trimmed = value.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

function defaultMarkdownUrl(urlPath: string): string {
  const normalized = normalizeUrlPath(urlPath);
  if (normalized.endsWith(".md")) {
    return normalized;
  }
  if (normalized === "/docs") {
    return "/docs/index.md";
  }
  return `${normalized}.md`;
}

function parseSearchInput(input: Record<string, unknown>): SearchDocsInput {
  const query = input.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("leadtype/webmcp: search-docs requires a non-empty query.");
  }
  const limit = input.limit;
  if (limit !== undefined) {
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
      throw new Error("leadtype/webmcp: search-docs limit must be an integer.");
    }
    return { query, limit };
  }
  return { query };
}

function parseGetPageInput(input: Record<string, unknown>): GetPageInput {
  const urlPath = input.urlPath;
  if (typeof urlPath !== "string" || urlPath.trim().length === 0) {
    throw new Error("leadtype/webmcp: get-page requires a non-empty urlPath.");
  }
  return { urlPath };
}

function resolveFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (!resolved) {
    throw new Error(
      "leadtype/webmcp: no fetch implementation available. Pass `options.fetch` when running without globalThis.fetch."
    );
  }
  return resolved;
}

export function registerWebMcpTools(
  tools: WebMcpTool[],
  options: RegisterWebMcpToolsOptions = {}
): RegisterWebMcpToolsResult {
  const modelContext = options.modelContext ?? resolveModelContext();
  if (!modelContext?.registerTool) {
    return { supported: false, unregister: () => undefined };
  }

  for (const tool of tools) {
    validateTool(tool);
  }

  const controller = new AbortController();
  for (const tool of tools) {
    modelContext.registerTool(tool, {
      exposedTo: options.exposedTo,
      signal: controller.signal,
    });
  }

  return {
    supported: true,
    unregister: () => {
      controller.abort();
    },
  };
}

export function createDocsWebMcpTools(
  options: DocsWebMcpToolsOptions = {}
): WebMcpTool[] {
  const collection = options.collection ?? DEFAULT_COLLECTION;
  const markdownUrl = options.markdownUrl ?? defaultMarkdownUrl;
  const fetchImpl = resolveFetch(options.fetch);

  return [
    {
      name: "search-docs",
      title: "Search documentation",
      description:
        "Search the documentation and return ranked results ({ title, urlPath, snippet }). Use get-page to read a full result.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: {
            type: "integer",
            minimum: 1,
            description: `Max results (default ${DEFAULT_SEARCH_LIMIT}).`,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const parsed = parseSearchInput(input);
        const client = createSearchClient(collection, {
          ...options,
          fetch: fetchImpl,
          limit: parsed.limit ?? options.limit ?? DEFAULT_SEARCH_LIMIT,
        });
        const results = await client.search(parsed.query);
        return results.map((result) => ({
          title: result.title,
          urlPath: result.urlPath,
          snippet: result.excerpt,
        }));
      },
    },
    {
      name: "get-page",
      title: "Get a documentation page",
      description:
        "Return the full Markdown of one documentation page by its urlPath (for example, the urlPath from a search-docs result).",
      inputSchema: {
        type: "object",
        properties: {
          urlPath: {
            type: "string",
            description: "Page path, e.g. /docs/quickstart.",
          },
        },
        required: ["urlPath"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const parsed = parseGetPageInput(input);
        const url = markdownUrl(parsed.urlPath);
        const response = await fetchImpl(url);
        if (!response.ok) {
          throw new Error(
            `leadtype/webmcp: failed to fetch ${url} (${response.status} ${response.statusText})`
          );
        }
        return await response.text();
      },
    },
  ];
}
