---
"leadtype": minor
---

Add `leadtype/mcp` — a docs MCP server (stdio + Streamable HTTP) over the generated artifacts.

A thin adapter over the existing search index + `.md` mirror, exposing two MCP tools: `search-docs(query, limit?)` (ranked `{ title, urlPath, snippet }`, wraps `searchDocs()`) and `get-page(urlPath)` (full Markdown, read from the `.md` mirror — byte-identical to content negotiation). `list-pages()` is optional, opt in via `tools`.

- **`leadtype mcp`** — new CLI command. Runs the stdio server for local IDE clients (Claude Desktop, Cursor, Cline) over generated artifacts. `--artifacts <dir>` (default `./public`) or `--package <name>` to serve a dependency's bundled docs; `--tools <list>` to choose tools.
- **`createMcpHandler(config)`** — a Web-standard `(Request) => Promise<Response>` handler the host mounts in its own route (Next, TanStack, SvelteKit, Nuxt, Astro, Workers). Stateless Streamable HTTP with JSON responses; **SSE is not emitted**. The host owns hosting — leadtype stays a layer.
- **`createDocsArtifacts({ index, manifest, content?, readMarkdown })`** — assembles artifacts in memory so hosts that already bundle the index/manifest (Vite/edge apps, no `fs` at request time) can pass them directly instead of a disk path. `createMcpHandler({ artifacts })` accepts either a directory string or a pre-built `DocsArtifacts`.
- Also exported: `createDocsMcpServer`, `runStdioServer`, `loadDocsArtifacts`, `resolveBundleArtifactsBase`, `defineDocsTools`.

`@modelcontextprotocol/sdk` (SDK v1.x) is an **optional peer dependency**, imported lazily only when the server runs — it stays out of every install, and a missing install surfaces an actionable error rather than a module-not-found. Tool input schemas are validated with Valibot.

Dogfooded in `apps/example`: a Nitro middleware mounts the server at `POST /mcp`, and `bun run mcp` serves the same docs over stdio.

Gate: MCP earns its keep for large corpora / SDK docs where agents want targeted retrieval. For docs that fit in `llms-full.txt`, skip it.
