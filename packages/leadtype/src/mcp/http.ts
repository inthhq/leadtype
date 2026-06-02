import { type DocsArtifacts, loadDocsArtifacts } from "./artifacts.js";
import {
  type CreateDocsMcpServerOptions,
  createDocsMcpServer,
  importSdkModule,
} from "./server.js";
import type { DefineDocsToolsOptions } from "./tools.js";

export type CreateMcpHandlerConfig = DefineDocsToolsOptions & {
  /**
   * Where the docs artifacts come from. A directory string (read from disk, default
   * `./public`) or a pre-built `DocsArtifacts` (from `createDocsArtifacts`) for hosts
   * that already bundle the index/manifest or run on an edge runtime without `fs`.
   */
  artifacts?: string | DocsArtifacts;
  serverInfo?: CreateDocsMcpServerOptions["serverInfo"];
};

function isLoadedArtifacts(
  artifacts: string | DocsArtifacts | undefined
): artifacts is DocsArtifacts {
  return typeof artifacts === "object" && artifacts !== null;
}

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
    if (isLoadedArtifacts(config.artifacts)) {
      return Promise.resolve(config.artifacts);
    }
    artifactsPromise ??= loadDocsArtifacts({ artifacts: config.artifacts });
    return artifactsPromise;
  };

  return async (request: Request): Promise<Response> => {
    let artifacts: DocsArtifacts;
    try {
      artifacts = await getArtifacts();
    } catch (error) {
      // Reset so a transient failure (e.g. artifacts not generated yet) can retry.
      artifactsPromise = null;
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load docs artifacts.";
      return jsonRpcErrorResponse(message, 500);
    }

    const { WebStandardStreamableHTTPServerTransport } = await importSdkModule<
      typeof import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js")
    >("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");

    const server = await createDocsMcpServer({
      artifacts,
      tools: config.tools,
      serverInfo: config.serverInfo,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);

    try {
      // JSON-response mode buffers the full response, so it is safe to close the
      // per-request server once handleRequest resolves.
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  };
}
