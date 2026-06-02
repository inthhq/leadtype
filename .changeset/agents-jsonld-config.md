---
"leadtype": minor
---

Make `renderSiteJsonLd` config-driven, and bake the JSON-LD options into the manifest.

The site-level JSON-LD graph is derived from the top-level `organization` (→ `Organization`)
and `product` (`kind`/`category`/`repository` → `SoftwareApplication`/`SoftwareSourceCode`),
flowing through `generate` → `generateAgentReadabilityArtifacts` → the `agent-readability.json`
manifest. `renderSiteJsonLd(manifest, overrides?)` reads it (explicit overrides still win), so a
host emits the site graph once with `renderSiteJsonLd(manifest)` — no need to repeat the
org/software options at the call site.

Dogfooded in `apps/example`: the shared `docs.config.ts` sets `organization` + `product.kind:
"library"` (→ `SoftwareSourceCode`) + `agents.robots`, marks Changelog `optional: true`, and
the root layout emits `renderSiteJsonLd(manifest)` so every page's `TechArticle` `@id`
references resolve.
