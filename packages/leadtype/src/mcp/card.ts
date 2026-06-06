import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeBaseUrl } from "../internal/docs-url.js";
import type { LlmsProductInfo } from "../llm/llm.js";

export const MCP_SERVER_CARD_PATH = ".well-known/mcp/server-card.json";
export const DEFAULT_MCP_ENDPOINT_PATH = "/mcp";
export const MCP_SERVER_CARD_SCHEMA_URL =
  "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json";
export const MCP_SERVER_CARD_SCHEMA_VERSION = "1.0";
export const MCP_SERVER_CARD_PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_MCP_SERVER_NAME = "leadtype-docs";
export const DEFAULT_MCP_SERVER_VERSION = "1.0.0";

export type McpServerCardToolsCapability = {
  listChanged?: boolean;
};

export type McpServerCardResourcesCapability = {
  subscribe?: boolean;
  listChanged?: boolean;
};

export type McpServerCardPromptsCapability = {
  listChanged?: boolean;
};

export type McpServerCardCapabilities = {
  tools?: McpServerCardToolsCapability;
  resources?: McpServerCardResourcesCapability;
  prompts?: McpServerCardPromptsCapability;
};

export type McpServerCardServerInfo = {
  name: string;
  version: string;
  description?: string;
};

export type McpServerCardTransport = {
  type: "streamable-http";
  endpoint: string;
};

export type McpServerCard = {
  $schema: string;
  version: string;
  protocolVersion: string;
  serverInfo: McpServerCardServerInfo;
  transport: McpServerCardTransport;
  capabilities: McpServerCardCapabilities;
  authentication: { required: boolean };
};

export type McpServerCardConfig = {
  endpoint?: string;
  serverInfo?: Partial<McpServerCardServerInfo>;
  capabilities?: Partial<McpServerCardCapabilities>;
  authentication?: { required?: boolean };
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

  return {
    name: config?.serverInfo?.name ?? toServerName(product.name),
    version: config?.serverInfo?.version ?? DEFAULT_MCP_SERVER_VERSION,
    ...(description ? { description } : {}),
  };
}

function resolveCapabilities(
  capabilities?: Partial<McpServerCardCapabilities>
): McpServerCardCapabilities {
  return {
    tools: capabilities?.tools ?? {},
    ...(capabilities?.resources ? { resources: capabilities.resources } : {}),
    ...(capabilities?.prompts ? { prompts: capabilities.prompts } : {}),
  };
}

function resolveAuthentication(
  authentication?: McpServerCardConfig["authentication"]
): McpServerCard["authentication"] {
  return { required: authentication?.required ?? false };
}

export function createMcpServerCard(
  options: Omit<GenerateMcpServerCardOptions, "outDir">
): McpServerCard {
  const config = options.config;

  return {
    $schema: MCP_SERVER_CARD_SCHEMA_URL,
    version: MCP_SERVER_CARD_SCHEMA_VERSION,
    protocolVersion: MCP_SERVER_CARD_PROTOCOL_VERSION,
    serverInfo: resolveMcpServerInfo(options.product, config),
    transport: {
      type: "streamable-http",
      endpoint: resolveMcpEndpoint(options.baseUrl, config?.endpoint),
    },
    capabilities: resolveCapabilities(config?.capabilities),
    authentication: resolveAuthentication(config?.authentication),
  };
}

export async function generateMcpServerCard(
  options: GenerateMcpServerCardOptions
): Promise<{ outputPath: string; card: McpServerCard }> {
  const outputPath = path.join(options.outDir, MCP_SERVER_CARD_PATH);
  const card = createMcpServerCard(options);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(card, null, 2)}\n`);
  return { outputPath, card };
}
