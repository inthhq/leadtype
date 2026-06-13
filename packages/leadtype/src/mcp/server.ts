// The SDK is imported statically — NOT through a variable-specifier dynamic
// import. A computed `import(specifier)` is invisible to bundlers and to
// serverless file tracing (Vercel/NFT), so deployments that resolved the SDK
// locally would 500 in production with the artifacts missing from the bundle.
// Importing `leadtype/mcp` therefore requires @modelcontextprotocol/sdk to be
// installed; the CLI keeps the SDK optional by loading this module lazily and
// mapping resolution failures to MISSING_SDK_MESSAGE (see missing-sdk.ts).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { DocsArtifacts } from "./artifacts.js";
import { type McpServerCardServerInfo, resolveMcpServerInfo } from "./card.js";
import {
  DocsToolInputError,
  type DefineDocsToolsOptions,
  type DocsToolName,
  defineDocsTools,
} from "./tools.js";

export type CreateDocsMcpServerOptions = DefineDocsToolsOptions & {
  artifacts: DocsArtifacts;
  serverInfo?: Partial<McpServerCardServerInfo>;
};

type StructuredJsonRpcError = Error & { code: number };

function createStructuredJsonRpcError(
  message: string,
  code: number
): StructuredJsonRpcError {
  const error = new Error(message) as StructuredJsonRpcError;
  error.code = code;
  return error;
}

function isStructuredJsonRpcError(error: unknown): error is StructuredJsonRpcError {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "number"
  );
}

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
  const tools = defineDocsTools(options.artifacts, options);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const serverInfo = resolveMcpServerInfo(options.artifacts.manifest.product, {
    serverInfo: options.serverInfo,
  });

  const server = new Server(
    {
      name: serverInfo.name,
      version: serverInfo.version,
      ...(serverInfo.description ? { description: serverInfo.description } : {}),
      ...(serverInfo.instructions ? { instructions: serverInfo.instructions } : {}),
    },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolsByName.get(request.params.name as DocsToolName);
    if (!tool) {
      throw createStructuredJsonRpcError(
        `Unknown tool: ${request.params.name}`,
        -32_601
      );
    }
    try {
      return await tool.handler(request.params.arguments ?? {});
    } catch (error) {
      if (error instanceof DocsToolInputError) {
        throw createStructuredJsonRpcError(error.message, error.code);
      }
      if (isStructuredJsonRpcError(error)) {
        throw error;
      }
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
