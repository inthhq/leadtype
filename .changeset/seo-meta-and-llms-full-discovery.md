---
"leadtype": minor
---

Add SEO/social head meta + `/.well-known/llms-full.txt` (DESIGN-2.md Phase 4).

`createDocsHead` now also emits `og:type`, a `twitter:card`, and — from an `agents.seo` config
block (baked into the manifest) with optional per-page overrides via its `seo` option —
`og:image`/`twitter:image`, `twitter:site`, and `keywords`. leadtype emits the `og:image` URL,
not the image (it ships no UI; generating a social card is the host's job). `SeoMeta` type added.

`leadtype generate` now also writes a discovery copy of `llms-full.txt` at
`/.well-known/llms-full.txt`, matching the existing `/.well-known/llms.txt`.

Dogfooded in `apps/example` via `agents.seo` in the shared `docs.config.ts`.
