---
"leadtype": minor
---

Support an `## Optional` section in `docs/llms.txt` via `optional: true` on a nav node.

Mark a nav section "safe to drop for shorter context" and its pages collapse into a single
trailing `## Optional` section in `docs/llms.txt` (the llms.txt convention for low-priority
links) instead of getting their own heading. The flag applies to the whole subtree and is
deduped by URL; it affects `docs/llms.txt` only — website nav, sitemap, and search still list
every page normally.

```ts
nav: [
  { title: "Reference", base: "reference", pages: [{ include: "*" }] },
  { title: "Changelog", base: "changelog", optional: true, pages: [{ include: "*" }] },
]
```
