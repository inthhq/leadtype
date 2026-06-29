import * as v from "valibot";
import {
  type AgentReadabilityPage,
  resolveManifestMarkdownMirrorTarget,
} from "../llm/readability.js";
import { type DocsSearchResult, searchDocs } from "../search/index.js";
import type { DocsArtifacts } from "./artifacts.js";

const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 50;
const MD_EXTENSION_PATTERN = /\.md$/;
const TRAILING_SLASH_PATTERN = /\/+$/;

/** The tools we expose. `list-pages` is optional (behind config). */
export const DOCS_TOOL_NAMES = [
  "search-docs",
  "get-page",
  "list-pages",
] as const;
export type DocsToolName = (typeof DOCS_TOOL_NAMES)[number];

export const DEFAULT_DOCS_TOOLS: DocsToolName[] = ["search-docs", "get-page"];

/**
 * Static title/description for each tool — the single source for both the
 * runtime registrations below and build-time surfaces (the MCP server card)
 * that must describe the tool surface without loading artifacts.
 */
export const DOCS_TOOL_SUMMARIES: Record<
  DocsToolName,
  { title: string; description: string }
> = {
  "search-docs": {
    title: "Search documentation",
    description:
      "Search the documentation and return ranked results " +
      "({ title, urlPath, snippet }). Use get-page to read a full result.",
  },
  "get-page": {
    title: "Get a documentation page",
    description:
      "Return the full Markdown of one documentation page by its urlPath " +
      "(e.g. the urlPath from a search-docs result).",
  },
  "list-pages": {
    title: "List documentation pages",
    description:
      "List all documentation pages with their title, urlPath and groups.",
  },
};

export type DocsToolAnnotations = {
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
};

/**
 * A single MCP text content block. Mirrors the MCP `CallToolResult` content shape
 * structurally so the registry stays free of any SDK import (keeps the SDK a lazy
 * dependency — DESIGN.md Q1).
 */
export type McpTextContent = { type: "text"; text: string };
export type McpToolResult = { content: McpTextContent[]; isError?: boolean };

export class DocsToolInputError extends Error {
  code = -32_602;

  constructor(message: string) {
    super(message);
    this.name = "DocsToolInputError";
  }
}

function formatIssueMessage(issues: readonly v.BaseIssue<unknown>[]): string {
  const issue = issues[0];
  if (!issue) {
    return "Invalid input.";
  }
  const dotPath = issue.path?.map((segment) => segment.key).join(".");
  return dotPath ? `${dotPath}: ${issue.message}` : issue.message;
}

/** A JSON Schema object advertised to clients via `tools/list`. */
export type JsonSchemaObject = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/**
 * A transport-agnostic tool definition. Both the stdio and HTTP servers register
 * from this single list, so a future MCP SDK v2 bump only touches the registration
 * adapter, not the tools themselves (DESIGN.md Q1).
 */
export type DocsTool = {
  name: DocsToolName;
  title: string;
  description: string;
  annotations?: DocsToolAnnotations;
  /** Advertised to clients. Hand-authored JSON Schema (SDK 1.x typed path is Zod-only). */
  inputSchema: JsonSchemaObject;
  /** Validates input with Valibot, then runs. Bad input throws a structured JSON-RPC error. */
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
};

export type DefineDocsToolsOptions = {
  /** Which tools to expose. Defaults to `search-docs` + `get-page`. */
  tools?: DocsToolName[];
};

function textResult(text: string, isError = false): McpToolResult {
  return { content: [{ type: "text", text }], isError };
}

function jsonResult(value: unknown): McpToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

const SearchInput = v.strictObject({
  query: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, "query must not be empty")
  ),
  limit: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_SEARCH_LIMIT))
  ),
});

const GetPageInput = v.strictObject({
  urlPath: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, "urlPath must not be empty")
  ),
});

const ListPagesInput = v.strictObject({});
const READ_ONLY_IDEMPOTENT_ANNOTATIONS = {
  idempotentHint: true,
  readOnlyHint: true,
} as const;

function toSearchHit(result: DocsSearchResult) {
  return {
    title: result.title,
    urlPath: result.urlPath,
    snippet: result.excerpt,
  };
}

function normalizePagePath(input: string): string {
  const trimmed = input.trim().replace(MD_EXTENSION_PATTERN, "");
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailing = withSlash.replace(TRAILING_SLASH_PATTERN, "");
  return withoutTrailing === "" ? "/" : withoutTrailing;
}

function findPage(
  artifacts: DocsArtifacts,
  urlPath: string
): AgentReadabilityPage | undefined {
  const normalized = normalizePagePath(urlPath);
  return artifacts.manifest.pages.find(
    (page) =>
      normalizePagePath(page.urlPath) === normalized ||
      normalizePagePath(page.markdownUrlPath) === normalized
  );
}

function createSearchTool(artifacts: DocsArtifacts): DocsTool {
  return {
    name: "search-docs",
    ...DOCS_TOOL_SUMMARIES["search-docs"],
    annotations: READ_ONLY_IDEMPOTENT_ANNOTATIONS,
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
    handler: async (args) => {
      const parsed = v.safeParse(SearchInput, args);
      if (!parsed.success) {
        throw new DocsToolInputError(
          `Invalid input: ${formatIssueMessage(parsed.issues)}`
        );
      }
      const { query, limit } = parsed.output;
      const results = searchDocs(artifacts.index, query, {
        limit: limit ?? DEFAULT_SEARCH_LIMIT,
        content: artifacts.content,
      });
      return jsonResult(results.map(toSearchHit));
    },
  };
}

function createGetPageTool(artifacts: DocsArtifacts): DocsTool {
  return {
    name: "get-page",
    ...DOCS_TOOL_SUMMARIES["get-page"],
    annotations: READ_ONLY_IDEMPOTENT_ANNOTATIONS,
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
    handler: async (args) => {
      const parsed = v.safeParse(GetPageInput, args);
      if (!parsed.success) {
        throw new DocsToolInputError(
          `Invalid input: ${formatIssueMessage(parsed.issues)}`
        );
      }
      const page = findPage(artifacts, parsed.output.urlPath);
      if (!page) {
        return textResult(
          `No page found at "${parsed.output.urlPath}". ` +
            "Use search-docs to find available pages.",
          true
        );
      }
      const target = resolveManifestMarkdownMirrorTarget(
        page.urlPath,
        artifacts.manifest
      );
      if (!target) {
        return textResult(
          `Page "${page.urlPath}" has no Markdown mirror.`,
          true
        );
      }
      const markdown = await artifacts.readMarkdown(target);
      if (markdown == null) {
        return textResult(
          `Markdown for "${page.urlPath}" is missing on disk (expected ${target.filePath}). ` +
            "Re-run `leadtype generate`.",
          true
        );
      }
      return textResult(markdown);
    },
  };
}

function createListPagesTool(artifacts: DocsArtifacts): DocsTool {
  return {
    name: "list-pages",
    ...DOCS_TOOL_SUMMARIES["list-pages"],
    annotations: READ_ONLY_IDEMPOTENT_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (args) => {
      const parsed = v.safeParse(ListPagesInput, args);
      if (!parsed.success) {
        throw new DocsToolInputError("Invalid input: unexpected arguments");
      }
      const pages = artifacts.manifest.pages.map((page) => ({
        title: page.title,
        urlPath: page.urlPath,
        groups: page.groups,
      }));
      return jsonResult(pages);
    },
  };
}

const TOOL_FACTORIES: Record<
  DocsToolName,
  (artifacts: DocsArtifacts) => DocsTool
> = {
  "search-docs": createSearchTool,
  "get-page": createGetPageTool,
  "list-pages": createListPagesTool,
};

/**
 * Builds the enabled docs tools over the loaded artifacts. The same list feeds
 * both the stdio and HTTP servers.
 */
export function defineDocsTools(
  artifacts: DocsArtifacts,
  options: DefineDocsToolsOptions = {}
): DocsTool[] {
  const enabled = options.tools ?? DEFAULT_DOCS_TOOLS;
  // Preserve a stable order and drop unknown/duplicate names.
  const seen = new Set<DocsToolName>();
  const tools: DocsTool[] = [];
  for (const name of enabled) {
    if (seen.has(name) || !TOOL_FACTORIES[name]) {
      continue;
    }
    seen.add(name);
    tools.push(TOOL_FACTORIES[name](artifacts));
  }
  return tools;
}
