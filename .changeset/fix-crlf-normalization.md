---
"leadtype": patch
---

Fix Windows builds and cross-platform output determinism.

- Rollup build: classify module ids as external with `path.isAbsolute` so resolved ids (e.g. `D:/…/src/i18n/index.ts`) are treated as internal on Windows, fixing `"../i18n" is imported as an external by "src/feed/index.ts"` build failures.
- Normalize CRLF line endings at content read sites so emitted `.md` mirrors and content hashes are byte-identical across platforms: `convert.ts` MDX source reads, `include.remark.ts` `<include>` partial reads, and `llm/skills.ts` skill body resolution (affects `SKILL.md` `integrity`/`digest` for bodies containing `\r\n`).
