---
"leadtype": minor
---

Make `renderSiteJsonLd` config-driven via `agents.jsonLd`, and bake it into the manifest.

`agents.jsonLd` (organization / software / searchUrlPattern) now flows through
`generate` → `generateAgentReadabilityArtifacts` → the `agent-readability.json` manifest, and
`renderSiteJsonLd(manifest, overrides?)` reads it (explicit overrides still win). A host emits
the site graph once with `renderSiteJsonLd(manifest)` — no need to repeat the org/software
options at the call site.

Dogfooded in `apps/example`: the shared `docs.config.ts` sets `agents.jsonLd` (library →
`SoftwareSourceCode`) + `agents.robots`, marks Changelog `optional: true`, and the root layout
emits `renderSiteJsonLd(manifest)` so every page's `TechArticle` `@id` references resolve.
