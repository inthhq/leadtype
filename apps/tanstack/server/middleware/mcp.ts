import { join } from "node:path";
import { createMcpHandler } from "leadtype/mcp";
import { defineEventHandler, getRequestURL } from "nitro/h3";

const MCP_PATH = "/mcp";

// Dogfood the docs MCP server: serve THIS site's own docs over Streamable HTTP. It reads the
// generated artifacts from `public/docs/` on disk (same place `leadtype generate` wrote them and
// the agent-readability middleware reads the `.md` mirror from). `search-docs` ranks over the
// index; `get-page` returns the `.md` mirror. The same docs are served over stdio via
// `bun run mcp` (the `leadtype mcp` CLI).
const handleMcp = createMcpHandler({
  artifacts: join(process.cwd(), "public"),
});

export default defineEventHandler(async (event) => {
  if (getRequestURL(event).pathname !== MCP_PATH) {
    return;
  }
  // h3 v2 exposes the Web Request as `event.req`; the handler returns a Web Response.
  return await handleMcp(event.req);
});
