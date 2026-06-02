---
"leadtype": minor
---

Add `leadtype mcp --check` — test the MCP server with no client, SDK, or editor.

Wiring up an IDE client just to confirm the docs MCP server returns the right pages was a pain.
`leadtype mcp --check [--query "<term>"]` loads the artifacts and exercises the tools directly
(reusing the SDK-free tool handlers), printing the exposed tools, the `search-docs` hits, and a
`get-page` byte count, then exits 0. No `@modelcontextprotocol/sdk`, no JSON-RPC, no editor
config. The usage text also points at `npx @modelcontextprotocol/inspector leadtype mcp …` for a
full client UI.
