---
"leadtype": minor
---

Add `product.blocks` for composing rich, agent-friendly `llms.txt` and `AGENTS.md`.

`ProductInfo` now accepts a single ordered `blocks` array that fully describes
the body after the summary blockquote. Each `LlmsBlock` is either a `markdown`
block (verbatim body under an optional heading — use for an overview, popularity
stats, hosting/credibility, community links) or a `links` block (a curated link
list resolved against the source docs). Array order is file order, so authors
can rename headings and place credibility content wherever indexers read first,
without placement flags.

`blocks` supersedes the `bullets`, `bestStartingPoints`, and `agentGuidance`
fields. Those continue to work and are internally synthesized into the
equivalent blocks, so existing configs emit identical output. `leadtype` does
no data fetching — author-supplied values (e.g. stars/downloads) can be computed
at build time in the config module.

The example app and leadtype's own docs config now dogfood `blocks`, and the
docs teach `blocks` as the way to author the product index.
