# Rubric: mount a sibling changelog under its own URL prefix

Task: give the single `leadtype generate` invocation that serves a sibling `changelog/` folder under `/changelog/...` (not `/docs/changelog/...`), and describe what it emits for `changelog/v1.mdx`.

Ground truth: repeat `--docs-dir` with the **`<dir>=<url-prefix>`** mount form — `--docs-dir changelog=/changelog` (alongside `--docs-dir docs`). That keeps the internal generated copy at **`public/docs/changelog/v1.md`** (so search and runtime helpers still find it), **also writes a static markdown mirror at `public/changelog/v1.md`**, and emits the canonical URL **`/changelog/v1.md`** in `llms.txt`, search metadata, sitemap entries, and `agent-readability.json`.

## REQUIRED — all must be satisfied
- Uses the mount syntax **`--docs-dir changelog=/changelog`** (the `dir=url-prefix` form), as a repeated `--docs-dir`. A plain `--docs-dir changelog` with no `=/changelog` does NOT remap the URL and is wrong.
- States the canonical/public URL is **`/changelog/...`** (e.g. `/changelog/v1.md`) — not `/docs/changelog/...`.
- Mentions the static mirror at `public/changelog/v1.md` and/or that the internal copy stays under `public/docs/changelog/` for search.

## Incorrect if
- Serves the pages at `/docs/changelog/...`.
- Omits the `=/changelog` URL-prefix part of the mount syntax.
- Invents a non-existent flag or config field.
