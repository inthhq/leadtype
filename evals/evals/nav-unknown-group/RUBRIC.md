# Rubric: nav vs group, and the unknown-group build failure

Task: explain the relationship between curated `nav` (in `docs.config.ts`) and the legacy `group` frontmatter field, and what happens at build time when a page declares a group the config doesn't know.

Ground truth: `nav` in `docs.config.ts` is the **curated source of truth** — it drives the sidebar/top-level docs areas, `llms.txt` sections, `AGENTS.md` grouping, sitemap markdown, and agent-readability navigation. `group` is **legacy/optional taxonomy**: still useful as a navigation **fallback** (for projects without `nav`) and for **search facets / broad taxonomy**, but not the curated mechanism. If a page declares a `group` slug **not present in the config**, the build **fails** with an `unknown group "<slug>"` error — by design, so broken navigation is caught at build time rather than silently shipped.

## REQUIRED — all must be satisfied
- Identifies **`nav`** (config) as the curated driver of sidebar/navigation, `llms.txt` sections, and `AGENTS.md` grouping.
- Identifies **`group`** as the legacy/optional field, still useful for fallback navigation and/or search facets/taxonomy.
- States that an unknown `group` slug causes the **build to fail** (an "unknown group" error), not a silent skip or mere warning.

## Incorrect if
- Says an unknown group is silently ignored, dropped, or only warned.
- Claims `group` is the primary/curated navigation mechanism over `nav`.
