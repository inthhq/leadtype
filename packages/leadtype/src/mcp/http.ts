import { type DocsArtifacts, loadDocsArtifacts } from "./artifacts.js";
import {
  type CreateDocsMcpServerOptions,
  createDocsMcpServer,
  importSdkModule,
} from "./server.js";
import type { DefineDocsToolsOptions } from "./tools.js";

export type CreateMcpHandlerConfig = DefineDocsToolsOptions & {
  /**
   * Directory containing the generated `docs/` folder (read from disk at request
   * time). Defaults to `./public`.
   */
  artifacts?: string;
  serverInfo?: CreateDocsMcpServerOptions["serverInfo"];
};

const INTERNAL_ERROR_CODE = -32_603;

function jsonRpcErrorResponse(message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: INTERNAL_ERROR_CODE, message },
      id: null,
    }),
    { status, headers: { "content-type": "application/json" } }
  );
}

/**
 * Creates a Web-standard request handler for the docs MCP server over Streamable
 * HTTP — the variant a host mounts in its own route (DESIGN.md §1, Q3):
 *
 * ```ts
 * // app/mcp/route.ts (Next App Router)
 * import { createMcpHandler } from "leadtype/mcp";
 * export const POST = createMcpHandler({ artifacts: "./public" });
 * ```
 *
 * Stateless mode with JSON responses (no SSE — DESIGN.md MCP constraint). Artifacts
 * load once and are reused; a fresh server + transport is built per request so
 * concurrent requests never share transport state. The returned `(Request) => Response`
 * shape mounts verbatim on any Web-standard runtime (Next, TanStack, SvelteKit, Nuxt,
 * Astro, Cloudflare Workers, Deno, Bun).
 */
export function createMcpHandler(
  config: CreateMcpHandlerConfig = {}
): (request: Request) => Promise<Response> {
  let artifactsPromise: Promise<DocsArtifacts> | null = null;
  const getArtifacts = (): Promise<DocsArtifacts> => {
    artifactsPromise ??= loadDocsArtifacts({ artifacts: config.artifacts });
    return artifactsPromise;
  };

  return async (request: Request): Promise<Response> => {
    // A mounted route must never throw unhandled (→ the host's generic 500).
    // Any failure — artifacts not generated, the optional SDK peer dep missing,
    // a transport error — is turned into a clean JSON-RPC error Response.
    try {
      let artifacts: DocsArtifacts;
      try {
        artifacts = await getArtifacts();
      } catch (error) {
        // Reset so a transient failure (e.g. artifacts not generated yet) retries.
        artifactsPromise = null;
        throw error;
      }

      const { WebStandardStreamableHTTPServerTransport } =
        await importSdkModule<
          typeof import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js")
        >("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");

      const server = await createDocsMcpServer({
        artifacts,
        tools: config.tools,
        serverInfo: config.serverInfo,
      });

      try {
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        // JSON-response mode buffers the full response, so it is safe to close
        // the per-request server once handleRequest resolves.
        return await transport.handleRequest(request);
      } finally {
        // Close even if transport construction / connect threw, so the
        // per-request server never leaks listeners.
        await server.close();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "MCP request failed.";
      return jsonRpcErrorResponse(message, 500);
    }
  };
}
