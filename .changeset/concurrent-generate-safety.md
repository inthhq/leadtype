---
"leadtype": patch
---

Make generation safe to invoke concurrently against a shared `outDir`.

Parallel task graphs (lint, typecheck, and build each depending on "docs are
generated") used to race on the shared output directory, causing intermittent
partial reads, ENOENT on files another run had just replaced, and half-written
artifacts.

- Every generated artifact (converted `docs/*.md`, `llms.txt`, `llms-full.txt`,
  search index, sitemaps, robots, feeds, MCP card, NLWeb, skills, sync
  manifests) is now written to a temp sibling and atomically renamed into
  place, so concurrent readers see the old content or the new content — never
  a truncated file.
- Delete-then-recreate windows are gone: the agent-skills surface and mounted
  markdown mirrors now write the new files first and prune stale ones after,
  instead of `rm -rf`-ing a live directory before rebuilding it.
- `leadtype generate` runs are single-flight per output directory via a
  cross-process lock stored under the system temp dir (keyed by the resolved
  `--out` path). Concurrent invocations wait for the in-flight run; locks
  abandoned by crashed runs are reclaimed after 10 minutes, and waiting runs
  fail loudly after 5 minutes instead of hanging CI. Set `LEADTYPE_NO_LOCK=1`
  to opt out.
