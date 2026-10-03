---
"leadtype": minor
---

Derive navigation and the `llms.txt` body when they aren't authored, so a new project reaches useful output from identity alone.

Navigation is derived from the content tree — root pages at the root, one section per top-level directory titled from its `index` page, ordered `index` first then frontmatter `order` then path, so it never depends on filesystem enumeration order. The `llms.txt` body becomes a "Best Starting Points" block built from that same resolved navigation, which keeps an agent's entry points from drifting from a reader's. Product name and tagline fall back to `package.json`.

Both `leadtype generate` and `createDocsSource()` derive the same tree, so the rendered sidebar and the generated artifacts agree. Explicit configuration always wins: authoring `navigation`, `groups`, or `llms.sections` turns inference off for that field, and inference never merges with or rewrites an authored value.

`leadtype generate --explain` reports every derived value, what it was derived from, and the field that takes control of it. Ambiguous derivations — pages with no frontmatter `title`, or more pages than the starting-points block lists — warn with the field to set.

`leadtype init` now scaffolds identity only.
