---
"leadtype": patch
---

`createMcpHandler` never throws unhandled — all failures become a JSON-RPC 500 Response.

Previously only artifact loading was guarded; a missing optional `@modelcontextprotocol/sdk`
peer dep (or any transport error) escaped as an unhandled exception, surfacing as the host's
generic 500. Now the whole request path is wrapped, so the client gets a clean JSON-RPC error
with the actionable message (e.g. "install @modelcontextprotocol/sdk") instead of an opaque
500. Found by dogfooding the mounted route in `apps/example`'s production build.
