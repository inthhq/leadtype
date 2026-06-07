---
"leadtype": minor
---

Move generate capability toggles toward config-driven defaults. `leadtype generate` now enriches markdown with Git-derived `lastModified` and `lastAuthor` by default, skipping safely when git metadata is unavailable. Bundle-mode MCP artifacts are inferred from `agents.mcp.enabled`, while the legacy `--mcp`, `--enrich-git`, and `init --webmcp` shortcut flags remain supported with deprecation warnings.
