---
"leadtype": minor
---

Add `llms.sections` for composing rich, agent-friendly `llms.txt` and `AGENTS.md`.

The top-level `llms.sections` array fully describes the body after the tagline
blockquote. Each `LlmsBlock` is either a `markdown` block (verbatim body under an
optional heading — use for an overview, popularity stats, hosting/credibility,
community links) or a `links` block (a curated link list resolved against the
source docs). Array order is file order, so authors can rename headings and place
credibility content wherever indexers read first, without placement flags.

`leadtype` does no data fetching — author-supplied values (e.g. stars/downloads)
can be computed at build time in the config module.

The example app and leadtype's own docs config now dogfood `llms.sections`, and
the docs teach it as the way to author the product index.
