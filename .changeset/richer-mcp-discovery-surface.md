---
"leadtype": minor
---

Richer MCP discovery surface. The generated server card now carries top-level `name`, `description`, `serverUrl`, and `tools[]` (static summaries of the enabled docs tools, configurable via `agents.mcp.tools`) alongside the existing `serverInfo`/`transport` fields, matching what agent-readiness scanners read. `generate` additionally writes a discovery copy of the card to `/.well-known/mcp.json`, and the root `llms.txt` gains an `## Agent Interfaces` section linking the MCP endpoint, its server card, and the NLWeb `/ask` endpoint when those surfaces are enabled.
