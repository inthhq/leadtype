---
"leadtype": minor
---

Add an agent-skills surface: `/.well-known/agent-skills` + a bundled `SKILL.md` (DESIGN-2.md Phase 3).

`leadtype generate` now emits a discoverable [`SKILL.md`](https://agentskills.io) surface (the
open Agent Skills format used by Claude Code, Cursor, Codex, Copilot, …). Default-on:

- **Site mode:** `/.well-known/agent-skills/index.json` (discovery manifest with `sha256` integrity)
  + `<name>/SKILL.md` per skill + a minimal `/.well-known/agent-card.json` (A2A).
- **Bundle mode (`--bundle`):** a single `SKILL.md` at the package root, next to `AGENTS.md`.

The auto **docs-skill** is a thin pointer that adapts to the surface — bundled `AGENTS.md`/`docs`
offline, else `/llms.txt` + the MCP server when `agents.mcp.enabled`. Declare capability skills via
`agents.skills.items[]` (`name`, `description`, `license?`, `compatibility?`, `allowedTools?`,
`body`/`bodyPath`); `docsSkill: false` drops the auto one, `agentCard: false` skips the card. New
`generateSkillArtifacts` exported from `leadtype/llm`.

Dogfooded: `apps/example` emits the site surface (and now scores 100/100 on `leadtype score`);
leadtype's own published tarball ships a `SKILL.md`.
