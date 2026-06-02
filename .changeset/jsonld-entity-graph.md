---
"leadtype": minor
---

JSON-LD: a referenced site-level entity graph + per-page `@id` references (DESIGN.md Phase 4).

Per-page `renderJsonLd` now references the site entities by `@id`
(`isPartOf: { "@id": ".../#website" }`, `publisher: { "@id": ".../#organization" }`) instead
of re-inlining a `WebSite` on every page, and reference/api-section pages are typed
`["TechArticle", "APIReference"]` automatically.

New `renderSiteJsonLd(manifest, options?)` emits the site-level `@graph` once — `Organization`
(canonical `@id`), `WebSite` with a `SearchAction`, and `SoftwareApplication` (or
`SoftwareSourceCode` for libraries) — so an answer engine builds one entity graph. Options
cover the organization name/url/logo, the software category, and the search URL template
(`searchUrlPattern: null` to omit). Exported from `leadtype/llm` and `leadtype/llm/readability`.

Behavior change: per-page JSON-LD `isPartOf` is now an `@id` reference; emit `renderSiteJsonLd`
on a root page so it resolves.
