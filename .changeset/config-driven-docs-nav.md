---
"leadtype": minor
---

Add config-driven docs navigation with nested sections, explicit page placement,
wildcard includes, and root-relative page references.

`defineDocsConfig()` and `defineCollection()` now accept `navigation`, which is used by
`resolveDocsNavigation()`, `llms.txt`, full-context generation, Agent
Readability, `AGENTS.md`, source navigation, and CLI generation. Frontmatter
`group` remains supported as taxonomy, validation metadata, and fallback
navigation for projects that have not adopted `navigation`.

This also updates the example docs site and c15t example to dogfood root
`navigation` nodes as top-level docs areas, with the active root node's pages and
children rendered as sidebar sections.
