import {
  type CreateDocsMcpServerOptions,
  createDocsMcpServer,
  importSdkModule,
} from "./server.js";

/**
 * Runs the docs MCP server over stdio (for local IDE clients: Claude Desktop,
 * Cursor, Cline). Resolves when the transport closes (stdin ends).
 */
export async function runStdioServer(
  options: CreateDocsMcpServerOptions
): Promise<void> {
  const { StdioServerTransport } = await importSdkModule<
    typeof import("@modelcontextprotocol/sdk/server/stdio.js")
  >("@modelcontextprotocol/sdk/server/stdio.js");
  const server = await createDocsMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // server.connect resolves once connected, not when the client disconnects.
  // Keep the process alive until the transport closes (stdin ends), otherwise the
  // CLI would exit immediately and the server would never answer a request.
  await new Promise<void>((resolve) => {
    const onClose = server.onclose;
    server.onclose = () => {
      onClose?.();
      resolve();
    };
  });
}
