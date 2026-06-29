import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeBaseUrl } from "../internal/docs-url.js";
import type { LlmsProductInfo } from "../llm/llm.js";
import {
  DEFAULT_DOCS_TOOLS,
  DOCS_TOOL_SUMMARIES,
  type DocsToolName,
} from "./tools.js";

export const MCP_SERVER_CARD_PATH = ".well-known/mcp/server-card.json";
/**
 * Discovery copy of the server card. Scanners that look for an MCP surface
 * probe `/.well-known/mcp.json` (a directory can't also be a file, so the
 * extensionless `/.well-known/mcp` stays a rewrite concern for hosts).
 */
export const MCP_WELL_KNOWN_PATH = ".well-known/mcp.json";
export const DEFAULT_MCP_ENDPOINT_PATH = "/mcp";
export const MCP_SERVER_CARD_SCHEMA_URL =
  "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json";
export const MCP_SERVER_CARD_SCHEMA_VERSION = "1.0";
// Pinned to the protocol revision the docs MCP server targets (see server.ts /
// http.ts). Bump alongside an SDK upgrade, not independently.
export const MCP_SERVER_CARD_PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_MCP_SERVER_NAME = "leadtype-docs";
export const DEFAULT_MCP_SERVER_VERSION = "1.0.0";

/**
 * The docs MCP server only serves tools, so the card always advertises
 * exactly that — capabilities are not configurable to keep the static card
 * honest about what the endpoint implements.
 */
export type McpServerCardCapabilities = {
  tools: Record<string, never>;
};

export type McpServerCardServerInfo = {
  name: string;
  version: string;
  description?: string;
  instructions?: string;
};

export type McpServerCardTransport = {
  type: "streamable-http";
  endpoint: string;
};

/** One advertised tool: static metadata so agents can preview the surface. */
export type McpServerCardToolSummary = {
  name: DocsToolName;
  title: string;
  description: string;
  annotations?: {
    idempotentHint?: boolean;
    readOnlyHint?: boolean;
  };
};

export type McpServerCard = {
  $schema: string;
  version: string;
  protocolVersion: string;
  /**
   * Top-level identity + endpoint duplicate `serverInfo`/`transport`. Registry
   * scanners (agentready.org, ora.ai) read flat `name`/`description`/
   * `serverUrl`/`tools` and mark the card incomplete without them.
   */
  name: string;
  description?: string;
  icon?: string;
  serverUrl: string;
  tools: McpServerCardToolSummary[];
  serverInfo: McpServerCardServerInfo;
  transport: McpServerCardTransport;
  capabilities: McpServerCardCapabilities;
  authentication: { required: boolean };
};

export type McpServerCardConfig = {
  endpoint?: string;
  serverInfo?: Partial<McpServerCardServerInfo>;
  authentication?: { required?: boolean };
  icon?: string;
  logo?: string;
  /** Tools the mounted server exposes. Defaults to `search-docs` + `get-page`. */
  tools?: DocsToolName[];
};

export type GenerateMcpServerCardOptions = {
  baseUrl?: string;
  config?: McpServerCardConfig;
  outDir: string;
  product: LlmsProductInfo;
};

const SERVER_NAME_PATTERN = /[^a-z0-9-]+/gi;
const SERVER_NAME_TRIM_PATTERN = /^-+|-+$/g;

function toServerName(productName: string): string {
  const normalized = productName
    .trim()
    .toLowerCase()
    .replace(SERVER_NAME_PATTERN, "-")
    .replace(SERVER_NAME_TRIM_PATTERN, "");
  if (!normalized || normalized === "docs" || normalized.endsWith("-docs")) {
    return normalized || "docs";
  }
  return `${normalized}-docs`;
}

function normalizeEndpoint(endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function createDefaultInstructions(summary: string): string {
  const trimmedSummary = summary.trim().replace(/[.!?]+$/, "");
  if (trimmedSummary.length === 0) {
    return "Search and read the documentation.";
  }
  return `Search and read the documentation for ${trimmedSummary}.`;
}

export function resolveMcpEndpoint(
  baseUrl: string | undefined,
  endpoint?: string
): string {
  const normalizedEndpoint = endpoint
    ? normalizeEndpoint(endpoint)
    : DEFAULT_MCP_ENDPOINT_PATH;
  if (/^https?:\/\//i.test(normalizedEndpoint)) {
    return normalizedEndpoint;
  }
  if (baseUrl) {
    return `${normalizeBaseUrl(baseUrl)}${normalizedEndpoint}`;
  }
  return normalizedEndpoint;
}

export function resolveMcpServerInfo(
  product: LlmsProductInfo,
  config?: McpServerCardConfig
): McpServerCardServerInfo {
  const description = config?.serverInfo?.description ?? product.summary;
  const instructions =
    config?.serverInfo?.instructions ??
    createDefaultInstructions(product.summary);

  return {
    name: config?.serverInfo?.name ?? toServerName(product.name),
    version: config?.serverInfo?.version ?? DEFAULT_MCP_SERVER_VERSION,
    ...(description ? { description } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

function resolveAuthentication(
  authentication?: McpServerCardConfig["authentication"]
): McpServerCard["authentication"] {
  return { required: authentication?.required ?? false };
}

function summarizeTools(tools?: DocsToolName[]): McpServerCardToolSummary[] {
  const enabled = tools ?? DEFAULT_DOCS_TOOLS;
  const seen = new Set<DocsToolName>();
  const summaries: McpServerCardToolSummary[] = [];
  for (const name of enabled) {
    if (seen.has(name) || !DOCS_TOOL_SUMMARIES[name]) {
      continue;
    }
    seen.add(name);
    summaries.push({
      name,
      ...DOCS_TOOL_SUMMARIES[name],
      annotations: {
        idempotentHint: true,
        readOnlyHint: true,
      },
    });
  }
  return summaries;
}

function resolveCardIcon(config?: McpServerCardConfig): string | undefined {
  return config?.icon ?? config?.logo;
}

export function createMcpServerCard(
  options: Omit<GenerateMcpServerCardOptions, "outDir">
): McpServerCard {
  const config = options.config;
  const serverInfo = resolveMcpServerInfo(options.product, config);
  const endpoint = resolveMcpEndpoint(options.baseUrl, config?.endpoint);
  const icon = resolveCardIcon(config);

  return {
    $schema: MCP_SERVER_CARD_SCHEMA_URL,
    version: MCP_SERVER_CARD_SCHEMA_VERSION,
    protocolVersion: MCP_SERVER_CARD_PROTOCOL_VERSION,
    name: serverInfo.name,
    ...(serverInfo.description ? { description: serverInfo.description } : {}),
    ...(icon ? { icon } : {}),
    serverUrl: endpoint,
    tools: summarizeTools(config?.tools),
    serverInfo,
    transport: {
      type: "streamable-http",
      endpoint,
    },
    capabilities: { tools: {} },
    authentication: resolveAuthentication(config?.authentication),
  };
}

export async function generateMcpServerCard(
  options: GenerateMcpServerCardOptions
): Promise<{
  outputPath: string;
  rootPath: string;
  wellKnownPath: string;
  card: McpServerCard;
}> {
  const outputPath = path.join(options.outDir, MCP_SERVER_CARD_PATH);
  const rootPath = path.join(options.outDir, "mcp.json");
  const wellKnownPath = path.join(options.outDir, MCP_WELL_KNOWN_PATH);
  const card = createMcpServerCard(options);
  const json = `${JSON.stringify(card, null, 2)}\n`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json);
  await writeFile(rootPath, json);
  await writeFile(wellKnownPath, json);
  return { outputPath, rootPath, wellKnownPath, card };
}
