---
"leadtype": minor
---

Add generated API catalog and homepage discovery Link helpers for agent-readable sites.

`generate` and `generateAgentArtifacts()` now emit `/.well-known/api-catalog` alongside robots and sitemap artifacts, route handlers can serve it dynamically, and `leadtype/llm/readability` exports helpers for RFC 8288 `Link` headers that advertise the catalog, service docs, service description, and sitemap. Robots output also includes scanner-friendly AI crawler aliases and renders Content-Signals in `ai-train, search, ai-input` order.
