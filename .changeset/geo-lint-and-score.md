---
"leadtype": minor
---

Add GEO structure checks: `geo:*` lint rules + a `leadtype score` command.

`leadtype lint` gains three warn-level rules — `geo:heading-skip` (a heading jumps a level),
`geo:code-language` (an unlabeled code fence), `geo:image-alt` (an image with no alt text) —
the mechanical half of the "Write for agents & GEO" guide.

New **`leadtype score`** command (and `leadtype/score` → `scoreDocs`) rates the
leadtype-addressable agent readiness of a generated build (0–100), mapped to the
[ora](https://ora.ai/score) rubric so you can coach toward a high external scan. It scores
**Identity** (llms.txt + `.well-known`, search index + manifest, sitemap/robots + Content-Signal,
JSON-LD readiness, description coverage, the `geo:*` structure signals) and **Agent Integration**
(MCP-ready artifacts, skills surface, offline docs); **Discovery / Auth & Access / User
Experience** are shown but excluded with a pointer. It scores what leadtype emits + your doc
structure — a local proxy, never live answer-engine ranking. `--json` for CI, `--min` to gate.
