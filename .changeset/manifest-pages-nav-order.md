---
"leadtype": patch
---

Sort `manifest.pages` from `generateAgentReadabilityArtifacts` in navigation
order instead of alphabetical `urlPath` order.

Navigation order (groups depth-first, then pages within each group) is the
authored reading order, which is what agent/LLM consumers of the manifest want.
Pages not present in the navigation are appended sorted by `urlPath`, so the
output stays fully deterministic. `sitemap.xml` is rendered from the same list
and now shares the navigation order; `sitemap.md` and `llms-full.txt` already
followed it. The bring-your-own-pages `generateAgentArtifacts` entry point is
unchanged — there the input `pages` order is the authored order.

Fixes #115.
