---
"leadtype": minor
---

Add NLWeb support under a new `leadtype/nlweb` entry. `createAskHandler()` mounts a Web-standard NLWeb `/ask` endpoint over the generated docs artifacts — list-mode answers backed by the same search index the docs MCP server uses, returning `{ query_id, _meta, results }` documents (each result carries `url`/`name`/`site`/`score`/`description`/`schema_object`) or SSE `start`/`result`/`complete` events when streaming is requested via `prefer.streaming`, `?streaming=`, or an `Accept: text/event-stream` header. Setting `agents.nlweb.enabled` in the docs config makes `leadtype generate` emit a schema.org JSONL feed at `/feeds/schema.jsonl`, a `/schema-map.xml` listing it, and a `Schemamap:` directive in robots.txt (also available directly via `renderRobotsTxt`/`createRobotsTxtResponse`'s new `schemamapUrlPath`).
