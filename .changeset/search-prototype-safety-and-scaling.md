---
"leadtype": patch
---

Fix docs search crashes and superlinear query latency on large corpora.

Indexing a corpus containing terms that collide with `Object.prototype` members (for example a doc mentioning `constructor`) crashed `createDocsSearchIndex`, and querying such a term crashed `searchDocs` on a `JSON.parse`'d index. The term postings record is now built with a null prototype and query-time lookups (including synonym expansion) use `Object.hasOwn` guards.

`searchDocs` also did a linear chunk scan and built an excerpt for every scored chunk, making query cost O(matched chunks × total chunks). Chunk-id lookups now use a cached map and excerpts are built only for results that survive the limit, with identical ranking. On a 20k-chunk corpus this cuts p95 query latency from ~665 ms to ~186 ms and makes latency scale linearly with corpus size.
