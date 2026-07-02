---
"leadtype": patch
---

Sort `manifest.pages` from `generateAgentReadabilityArtifacts` in navigation
order instead of alphabetical `urlPath` order.

Navigation order (groups depth-first, then pages within each group) is the
authored reading order, which is what agent/LLM consumers of the manifest want.
Pages not present in the navigation are appended sorted by `urlPath`, so the
output stays fully deterministic. `sitemap.xml` is rendered from the same list
and now shares the navigation order; `sitemap.md` already followed it.

`generateLLMFullContextFiles` now applies the same ordering in legacy `groups`
mode (it previously only reordered under curated `nav`), so `llms-full.txt`
stays in sync with the manifest in both modes. The bring-your-own-pages
`generateAgentArtifacts` entry point is unchanged — there the input `pages`
order is the authored order.

Fixes #115.
