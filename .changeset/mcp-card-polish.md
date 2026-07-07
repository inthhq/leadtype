---
"leadtype": patch
---

Polish the docs MCP surface for MCP clients and agent-readiness scanners.

- The generated server card now carries `serverInfo.instructions` — defaulting
  to a summary-derived "Search and read the documentation for …", overridable
  via `agents.mcp.serverInfo.instructions` — and the live server advertises the
  same instructions in its `initialize` response.
- Tool summaries on the card carry `readOnlyHint`/`idempotentHint` annotations,
  and `agents.mcp.icon` (or its `logo` alias) sets a card icon for registries
  and scanners.
- Generate additionally writes the card to a root `/mcp.json`, alongside the
  existing card path and the `/.well-known/mcp.json` discovery copy.
- Invalid tool calls surface structured JSON-RPC errors with proper error codes
  instead of generic internal errors.
