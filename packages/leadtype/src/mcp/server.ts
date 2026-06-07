import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { DocsArtifacts } from "./artifacts.js";
import { type McpServerCardServerInfo, resolveMcpServerInfo } from "./card.js";
import {
  type DefineDocsToolsOptions,
  type DocsToolName,
  defineDocsTools,
} from "./tools.js";

const MISSING_SDK_MESSAGE =
  "leadtype mcp: the optional peer dependency @modelcontextprotocol/sdk is not installed. " +
  "Install it to run the docs MCP server: `bun add @modelcontextprotocol/sdk`.";

/**
 * Dynamically imports an MCP SDK module, turning a missing optional peer dependency
 * into a clear, actionable error (DESIGN.md Q1 — the SDK stays out of every install
 * and is only required when actually running an MCP server).
 */
const MODULE_NOT_FOUND_CODES = new Set([
  "ERR_MODULE_NOT_FOUND", // Node ESM
  "MODULE_NOT_FOUND", // Bun / CJS
]);
const MODULE_NOT_FOUND_MESSAGE = /cannot find (module|package)/i;

export async function importSdkModule<T>(specifier: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    const message = error instanceof Error ? error.message : "";
    if (
      (code && MODULE_NOT_FOUND_CODES.has(code)) ||
      MODULE_NOT_FOUND_MESSAGE.test(message)
    ) {
      throw new Error(MISSING_SDK_MESSAGE, { cause: error });
    }
    throw error;
  }
}

export type CreateDocsMcpServerOptions = DefineDocsToolsOptions & {
  artifacts: DocsArtifacts;
  serverInfo?: Partial<McpServerCardServerInfo>;
};

/**
 * Builds a low-level MCP `Server` that serves the docs tools. We use the low-level
 * `Server` (not the high-level `McpServer.registerTool`) because in SDK 1.x the typed
 * `inputSchema` accepts only Zod, while our tool schemas are Valibot + hand-authored
 * JSON Schema. Tools advertise JSON Schema and validate args with Valibot internally,
 * so the registry stays Zod-free and the v2 bump is mechanical (DESIGN.md Q1).
 */
export async function createDocsMcpServer(
  options: CreateDocsMcpServerOptions
): Promise<Server> {
  const { Server } = await importSdkModule<
    typeof import("@modelcontextprotocol/sdk/server/index.js")
  >("@modelcontextprotocol/sdk/server/index.js");
  const { CallToolRequestSchema, ListToolsRequestSchema } =
    await importSdkModule<typeof import("@modelcontextprotocol/sdk/types.js")>(
      "@modelcontextprotocol/sdk/types.js"
    );

  const tools = defineDocsTools(options.artifacts, options);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const serverInfo = resolveMcpServerInfo(options.artifacts.manifest.product, {
    serverInfo: options.serverInfo,
  });

  const server = new Server(
    { name: serverInfo.name, version: serverInfo.version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolsByName.get(request.params.name as DocsToolName);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Unknown tool: ${request.params.name}` },
        ],
        isError: true,
      };
    }
    // A tool throwing (bad args, I/O failure) should surface as a normal
    // `isError` tool response, not a request-level exception that breaks the
    // whole MCP interaction.
    try {
      return await tool.handler(request.params.arguments ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Tool "${tool.name}" failed: ${message}` },
        ],
        isError: true,
      };
    }
  });

  return server;
}
