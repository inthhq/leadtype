---
"leadtype": patch
---

Use Hexbus to dispatch every Leadtype CLI command and add a top-level `--version` flag. Preserve command-local options and the existing exit codes, output streams, and help text. Load TypeScript configs through the normal package entrypoint so installed builds can import `leadtype`.
