---
"leadtype": minor
---

Flesh out `/.well-known/agent-card.json` as a proper [A2A](https://agent2agent.info) AgentCard.

It now emits the standard fields — `name`, `description`, `url` (the MCP endpoint when enabled,
else the site), `version`, `capabilities`, `defaultInputModes`/`defaultOutputModes`, and each
skill as `{ id, name, description, tags }` — plus `provider` and `documentationUrl`. `provider`
reuses the top-level `organization` (same entity) and `documentationUrl` is `product.docs`
(default `<baseUrl>/docs`); both are overridable. The previous non-standard `mcp` field is
dropped (the MCP endpoint is now the standard `url`).
