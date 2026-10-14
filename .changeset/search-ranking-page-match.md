---
"leadtype": minor
---

Rank docs search results by the page they come from, not only by term counts. Regenerate search artifacts with this release: the index format is now version 4. The browser search client, MCP artifact loading and NLWeb `/ask` reject a version 3 index with an error that says to regenerate, instead of searching it with the new tokenizer and quietly missing matches.

- A chunk's score is multiplied by how much of the query its page title, URL path and own heading cover. A page titled "Consent categories" now outranks a release note that repeats both words, and `vue quickstart` finds `/docs/frameworks/vue/quickstart` when the title is only "Quickstart".
- Camel-case names index their parts and short dotted or hyphenated names index their joined form, so `consent banner` matches a page titled `ConsentBanner` and `nextjs` matches "Next.js".
- A page's description is indexed with its first chunk only. Repeating it in every chunk let pages with long descriptions outrank the sections that answer the query. The index is also smaller.
- `searchDocs` returns at most two chunks per page before applying `limit`. Set `maxResultsPerPage` to change this. NLWeb `/ask` uses `maxResultsPerPage: 1`, so it now fills its result limit instead of returning fewer results after removing duplicate pages.
- Queries with two or more words skip phrase matching for chunks that cannot reach the results, which makes broad queries several times faster on large indexes.
