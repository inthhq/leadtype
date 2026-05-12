---
"leadtype": patch
---

Shrink published install closure by swapping out heavier deps:

- `gray-matter` → `vfile-matter` + `yaml` (drops `js-yaml`, `kind-of`, `section-matter`, `strip-bom-string` from the closure).
- `jiti` moved from `dependencies` to optional `peerDependencies` — only required when authoring `docs.config.ts`; `.js`/`.mjs`/`.cjs` configs load via native `import()`.
- `decode-named-character-reference` dropped — entity decode inside `<Steps>` titles now uses a small inline map.
- `mdast-util-to-markdown` dropped in `prompt.remark` — serialization now goes through the existing `remark()` processor.
- `mdast-util-compact` dropped in `steps.remark` — small in-tree adjacent-text/blockquote merge inlined.
- `unist-builder` dropped — `u(...)` calls replaced with mdast object literals.
- `unist-util-is` dropped — 7 `is(node, "type")` call sites switched to `node.type === "type"`.

Behavior change: YAML frontmatter timestamps now round-trip through the `yaml` package's timestamp tag. Date-only scalars like `2026-04-19` emit as `2026-04-19` (compact) instead of `2026-04-19T00:00:00.000Z`. Datetime scalars without sub-second precision emit as `2026-04-19T12:00:00` instead of `2026-04-19T12:00:00.000Z`. The values remain `Date` instances in JS, so consuming code is unaffected.
