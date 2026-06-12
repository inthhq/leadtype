---
"leadtype": minor
---

Fix the docs MCP server 500ing in serverless production deployments. `leadtype/mcp` previously loaded `@modelcontextprotocol/sdk` through a variable-specifier dynamic import, which bundlers and serverless file tracing (Vercel/NFT) cannot see — so deployments that resolved the SDK locally shipped functions without it and every `/mcp` request failed with "the optional peer dependency @modelcontextprotocol/sdk is not installed". The SDK is now imported statically by `mcp/server`, `mcp/http`, and `mcp/stdio`, so tracing includes it automatically. Importing `leadtype/mcp` therefore requires the SDK to be installed (it was already required to serve requests); the CLI still runs every non-serving command — including `leadtype mcp --check` — without it by loading the server lazily.
