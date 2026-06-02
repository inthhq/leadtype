---
"leadtype": minor
---

Add llms.txt discovery: `/.well-known/llms.txt` + `Link`/`X-Llms-Txt` response headers.

`leadtype generate` now also writes a discovery copy of the root `llms.txt` at
`/.well-known/llms.txt` (served statically from the output dir), so crawlers that probe
the well-known location find the site index without guessing.

`createMarkdownResponseHeaders` (and therefore `createAgentMarkdownResponse`) now advertise
the index on every markdown response via `Link: </llms.txt>; rel="llms-txt"` and
`X-Llms-Txt: /llms.txt`. Override the path with `llmsTxtPath` (e.g. `/docs/llms.txt`) or pass
`llmsTxtPath: null` to omit the discovery headers. The mandatory `Vary: Accept` and
`Content-Type: text/markdown; charset=utf-8` headers are unchanged.

The generate JSON output reports the new path as `files.wellKnownLlmsTxt`.
