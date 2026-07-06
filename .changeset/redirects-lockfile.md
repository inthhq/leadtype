---
"leadtype": minor
---

Add opt-in redirect tracking for renamed and deleted docs pages, so old URLs
stop 404ing in search engines and agent indexes.

Enable it with a `redirects` block in `docs.config.ts`. `leadtype generate`
then maintains a committed lockfile (`paths.lock.json` next to the docs
sources) recording every published path with a content hash, and emits
`<out>/docs/redirects.json`:

- **Pure moves are detected automatically** — a path that disappears while
  its content hash reappears at a new path gets a permanent 308 redirect
  with zero authoring. Hashes exclude frontmatter, so git-enrichment churn
  doesn't defeat the match, and ambiguous matches are never guessed.
- **Unexplained disappearances fail the build loudly**, listing each path
  with the fix: add `redirectFrom: [<old path>]` frontmatter to the
  successor page, or acknowledge intentional deletions under
  `redirects.removed` to serve 410 Gone.
- **Redirects accumulate and self-maintain**: chains from successive renames
  collapse to the final target, entries whose target is later removed
  degrade to 410, and entries whose path comes back alive are dropped.
- New `leadtype/redirects` entry point exports `resolveRedirect` (plus the
  lockfile/computation primitives) for serving redirects in any framework's
  catch-all. `createAgentMarkdownResponse` accepts the entries directly and
  answers agent-shaped requests for renamed pages — including `.md`
  mirrors — with the 308/410, while browser requests fall through to the
  host app's routing.
- Enabling `redirects` also enables conversion pruning, since rename
  detection requires stale mirrors of renamed sources to be
  garbage-collected from the output set.
- `redirectFrom` is now part of the default frontmatter lint schema.
