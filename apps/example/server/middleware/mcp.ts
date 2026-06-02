import { createDocsArtifacts, createMcpHandler } from "leadtype/mcp";
import type { DocsSearchContentStore, DocsSearchIndex } from "leadtype/search";
import { defineEventHandler, getRequestURL } from "nitro/h3";
import manifestJson from "../../src/generated/agent-readability.json" with {
  type: "json",
};
import searchContent from "../../src/generated/docs-search-content.json" with {
  type: "json",
};
import searchIndex from "../../src/generated/docs-search-index.json" with {
  type: "json",
};
import { readMarkdownFile } from "../utils/agent-readability";

const MCP_PATH = "/mcp";

// Dogfood the docs MCP server: serve THIS site's own docs over Streamable HTTP, reusing
// the artifacts the app already bundles (search index + readability manifest) and the
// existing Markdown reader — no extra disk reads, edge-portable. `search-docs` ranks over
// the bundled index; `get-page` returns the `.md` mirror from `public/`. The same docs are
// served over stdio via `bun run mcp` (the `leadtype mcp` CLI).
const handleMcp = createMcpHandler({
  artifacts: createDocsArtifacts({
    index: searchIndex as unknown as DocsSearchIndex,
    content: searchContent as unknown as DocsSearchContentStore,
    manifest: manifestJson,
    readMarkdown: readMarkdownFile,
  }),
});

export default defineEventHandler(async (event) => {
  if (getRequestURL(event).pathname !== MCP_PATH) {
    return;
  }
  // h3 v2 exposes the Web Request as `event.req`; the handler returns a Web Response.
  return await handleMcp(event.req);
});
