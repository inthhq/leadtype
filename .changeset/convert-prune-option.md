---
"leadtype": minor
---

Add an opt-in `prune` option to `convertAllMdx` that removes orphaned `.md`
outputs when a source page is deleted or renamed.

Previously a renamed page left its old `.md` behind in `outDir` — a live URL
with stale content that leaked into sitemaps, link checks, and search
indexing — and every consumer had to hand-roll the same garbage-collection
step. With `prune: true`, `convertAllMdx` deletes any `.md` under `outDir`
that the current source set did not produce, then removes directories the
deletions emptied.

Guardrails:

- Only `.md` files are candidates; other files sharing `outDir` are never
  touched, and `sitemap.md` is always kept.
- Pruning is skipped (with a warning) when any page fails to convert or when
  `srcDir` resolves to zero pages, so a partial or misconfigured run never
  mass-deletes output.
- `pruneKeep` globs (relative to `outDir`) exempt `.md` files written by
  other tools, e.g. `pruneKeep: ["mirrors/**"]`.
- While pruning, the run holds the same per-`outDir` lock as
  `leadtype generate` (reentrant when generate itself is the caller;
  `LEADTYPE_NO_LOCK=1` opts out), so a prune cannot delete output a
  concurrent run just wrote.
