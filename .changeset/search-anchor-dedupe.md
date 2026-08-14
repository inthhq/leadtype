---
"leadtype": patch
---

De-duplicate repeated heading anchors in the search index. Chunk anchors were slugified straight from the heading text with no duplicate counter, so every section sharing a heading title (`Example`, `Parameters`, `Returns` on an API reference page) collapsed onto the same anchor and search results deep-linked to the first one. Anchors are now numbered the way `extractDocsTableOfContents` and the rendered page number them (`example`, `example-1`).
