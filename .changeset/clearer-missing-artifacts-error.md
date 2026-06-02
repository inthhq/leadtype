---
"leadtype": patch
---

Clearer "no generated docs" error from `leadtype mcp` / `score`. It now lists all three fixes —
run `leadtype generate`, point `--artifacts <dir>` at a generated `docs/` folder, or pass
`--package <name>` for an installed package's bundled docs — and drops the misleading `mcp:`
prefix (the loader is shared with `score`).
