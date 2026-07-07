---
"leadtype": minor
---

Add parse-level code snippet linting (`snippet:parse`, the first tier of
#93): every fenced code block with a known language must parse — TS/TSX/JS
via the TypeScript parser (skipped when the optional `typescript` peer
dependency isn't installed), JSON and YAML via real parsers.

Docs snippets are deliberately fragmentary, so the checker is
fragment-tolerant before it reports: bare API signatures, `key: value`
config excerpts, object- and type-shape blocks, sibling JSX examples, and
`...` ellipsis lines all parse without annotation, as do JSON comments,
trailing commas, and multi-document YAML. Anything else can be marked
deliberate with a twoslash-style `// @noErrors` line — the same directive
the upcoming typecheck tier honors.

Tuned on leadtype's own 51-page docs corpus: zero annotations needed, and
the only findings were real bugs (a JSX component in a `ts` fence and
config excerpts that couldn't parse standalone).
