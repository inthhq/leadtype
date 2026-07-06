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
- New edge-safe `leadtype/redirects` entry point exports `resolveRedirect`
  and the pure computation primitives for serving redirects in any
  framework's catch-all (no Node built-ins, so it links in Cloudflare
  Workers / Vercel Edge); generate-time lockfile IO lives under
  `leadtype/redirects/node`. `createAgentMarkdownResponse` accepts the
  entries directly and answers agent-shaped requests for renamed pages —
  including `.md` mirrors, with index-route targets resolved to their real
  `index.md` mirror path — with the 308/410, while browser requests fall
  through to the host app's routing.
- Enabling `redirects` also enables conversion pruning, since rename
  detection requires stale mirrors of renamed sources to be
  garbage-collected from the output set.
- Filtered generates (`--include` / `--exclude`) skip redirect tracking and
  pruning with a warning — a partial page set would make every excluded page
  look deleted.
- `redirectFrom` is now part of the default frontmatter lint schema.
