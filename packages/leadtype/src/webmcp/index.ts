import {
  createSearchClient,
  type SearchClientOptions,
} from "../search/client.js";

const DEFAULT_COLLECTION = "docs";
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 25;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const COLLECTION_SLUG_INVALID_PATTERN = /[^a-z0-9_.-]+/g;
const COLLECTION_SLUG_TRIM_PATTERN = /^-+|-+$/g;
// Backslashes alias to "/" in URL parsing, "?"/"#" smuggle query/fragment, and
// whitespace never appears in a generated docs path.
const FORBIDDEN_URL_PATH_CHARACTERS = /[\\?#\s]/;
const PARENT_SEGMENT = "..";

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

  /**
   * Validate `get-page` paths against the search index and reject unknown
   * pages with a hint to use the search tool. The check fails open when the
   * index cannot be loaded (syntactic validation still applies).
   *
   * @defaultValue `true`
   */
  validatePages?: boolean;
};

/** Options for {@link registerDocsWebMcpTools}. */
export type RegisterDocsWebMcpToolsOptions = DocsWebMcpToolsOptions &
  RegisterWebMcpToolsOptions;

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

type DocsToolNames = {
  search: string;
  getPage: string;
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

function debugUnsupportedModelContext(): void {
  if (typeof process === "undefined" || process.env.NODE_ENV === "production") {
    return;
  }
  console.debug(
    "leadtype/webmcp: document.modelContext / navigator.modelContext is unavailable — tools were not registered. This is expected in browsers without WebMCP."
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

/**
 * Normalize and reject paths that would escape the site's own URL space:
 * protocol-relative (`//host`), backslash aliases, parent segments, and
 * query/fragment smuggling. Tool input is agent-controlled; without this,
 * `get-page` doubles as a cross-origin fetch proxy.
 */
function assertSafeUrlPath(toolName: string, value: string): string {
  const normalized = normalizeUrlPath(value);
  if (
    normalized.startsWith("//") ||
    FORBIDDEN_URL_PATH_CHARACTERS.test(normalized) ||
    normalized.split("/").includes(PARENT_SEGMENT)
  ) {
    throw new Error(
      `leadtype/webmcp: ${toolName} received an invalid urlPath "${value}". Pass a same-site page path such as /docs/quickstart.`
    );
  }
  return normalized;
}

function resolveToolNames(collection: string): DocsToolNames {
  if (collection === DEFAULT_COLLECTION) {
    return { search: "search-docs", getPage: "get-page" };
  }
  const slug = collection
    .toLowerCase()
    .replace(COLLECTION_SLUG_INVALID_PATTERN, "-")
    .replace(COLLECTION_SLUG_TRIM_PATTERN, "");
  const names = { search: `search-${slug}`, getPage: `get-${slug}-page` };
  if (
    !(
      TOOL_NAME_PATTERN.test(names.search) &&
      TOOL_NAME_PATTERN.test(names.getPage)
    )
  ) {
    throw new Error(
      `leadtype/webmcp: collection "${collection}" cannot be turned into valid tool names.`
    );
  }
  return names;
}

function createDefaultMarkdownUrl(
  collection: string
): (urlPath: string) => string {
  const collectionRoot = `/${collection}`;
  return (urlPath) => {
    const normalized = normalizeUrlPath(urlPath);
    if (normalized.endsWith(".md")) {
      return normalized;
    }
    if (normalized === collectionRoot) {
      return `${collectionRoot}/index.md`;
    }
    return `${normalized}.md`;
  };
}

function parseSearchInput(
  toolName: string,
  input: Record<string, unknown>
): SearchDocsInput {
  const query = input.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error(`leadtype/webmcp: ${toolName} requires a non-empty query.`);
  }
  const limit = input.limit;
  if (limit !== undefined) {
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
      throw new Error(
        `leadtype/webmcp: ${toolName} limit must be a positive integer.`
      );
    }
    return { query, limit: Math.min(limit, MAX_SEARCH_LIMIT) };
  }
  return { query };
}

function parseGetPageInput(
  toolName: string,
  input: Record<string, unknown>
): GetPageInput {
  const urlPath = input.urlPath;
  if (typeof urlPath !== "string" || urlPath.trim().length === 0) {
    throw new Error(
      `leadtype/webmcp: ${toolName} requires a non-empty urlPath.`
    );
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
  // Validate before the support check so mistakes surface in every browser,
  // not only the ones with WebMCP enabled.
  for (const tool of tools) {
    validateTool(tool);
  }

  const modelContext = options.modelContext ?? resolveModelContext();
  if (!modelContext?.registerTool) {
    debugUnsupportedModelContext();
    return { supported: false, unregister: () => undefined };
  }

  const controller = new AbortController();
  try {
    for (const tool of tools) {
      modelContext.registerTool(tool, {
        exposedTo: options.exposedTo,
        signal: controller.signal,
      });
    }
  } catch (error) {
    // Keep registration atomic: roll back already-registered tools when a
    // later one throws (e.g. a duplicate-name InvalidStateError).
    controller.abort();
    throw error;
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
  const names = resolveToolNames(collection);
  const markdownUrl =
    options.markdownUrl ?? createDefaultMarkdownUrl(collection);
  const fetchImpl = resolveFetch(options.fetch);
  const validatePages = options.validatePages ?? true;
  const documentsClient = createSearchClient(collection, {
    ...options,
    fetch: fetchImpl,
  });

  let knownUrlPathsPromise: Promise<Set<string> | null> | null = null;
  function loadKnownUrlPaths(): Promise<Set<string> | null> {
    const existing = knownUrlPathsPromise;
    if (existing) {
      return existing;
    }
    const promise: Promise<Set<string> | null> = documentsClient
      .documents()
      .then(
        (records) =>
          new Set(records.map((record) => normalizeUrlPath(record.urlPath)))
      )
      .catch(() => {
        // Fail open: when the index is unreachable, syntactic validation
        // still applies and the next call retries the index.
        knownUrlPathsPromise = null;
        return null;
      });
    knownUrlPathsPromise = promise;
    return promise;
  }

  return [
    {
      name: names.search,
      title: "Search documentation",
      description: `Search the documentation and return ranked results ({ title, urlPath, snippet }). Use ${names.getPage} to read a full result.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: MAX_SEARCH_LIMIT,
            description: `Max results (default ${DEFAULT_SEARCH_LIMIT}).`,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const parsed = parseSearchInput(names.search, input);
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
      name: names.getPage,
      title: "Get a documentation page",
      description: `Return the full Markdown of one documentation page by its urlPath (for example, the urlPath from a ${names.search} result).`,
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
        const parsed = parseGetPageInput(names.getPage, input);
        const urlPath = assertSafeUrlPath(names.getPage, parsed.urlPath);
        if (validatePages) {
          const knownUrlPaths = await loadKnownUrlPaths();
          if (knownUrlPaths && !knownUrlPaths.has(urlPath)) {
            throw new Error(
              `leadtype/webmcp: ${names.getPage} does not know "${urlPath}". Call ${names.search} to find a valid urlPath.`
            );
          }
        }
        const url = markdownUrl(urlPath);
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

/**
 * Create and register the generated docs tools in one call. This is the
 * blessed path — use {@link createDocsWebMcpTools} + {@link registerWebMcpTools}
 * only when mixing in custom tools.
 *
 * @example
 * ```ts
 * const registration = registerDocsWebMcpTools();
 * // later, when the page/component unloads:
 * registration.unregister();
 * ```
 */
export function registerDocsWebMcpTools(
  options: RegisterDocsWebMcpToolsOptions = {}
): RegisterWebMcpToolsResult {
  return registerWebMcpTools(createDocsWebMcpTools(options), options);
}
