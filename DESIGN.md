# DESIGN: leadtype agent surface

Status: shipped (all four phases) · One coherent release · Owner: Kaylee

## Why

[ora's Agent Readiness Score](https://ora.ai/score/c15t.com) graded c15t.com a **D
(46/100)**. Mapping its rubric to leadtype's lane was clarifying — and corrected an
early misread:

| ora dimension (Deep Scan v1.2) | pts | what it actually checks | leadtype's lane? |
|---|---|---|---|
| Discovery | 24 | answer-engine **recall** (does the model know you by name/category) | No — brand/training-data |
| **Identity** | 22 | **llms.txt format, JSON-LD, sitemap/robots, metadata, docs clarity** | **Yes — this is the lane** |
| Auth & Access | 30 | OpenAPI, OAuth, scoped permissions, dev-portal | No — backend |
| Agent Integration | 20 | **MCP server readiness, JSON errors, SDK coverage, function-calling** | Partial — docs MCP |
| User Experience | 4 | MCP *Apps* (`ui://` resources, `_meta.ui`) | No — needs UI |

`llms.txt` and friends live under **Identity**, not Discovery. leadtype already emits
most of those signals; the work here is **polish + two net-new surfaces**, shipped as
one "agent surface" release.

**Honest framing (carry into the docs):** these signals are high-value for
*developer/IDE agents and MCP tooling*, low-value for *answer-engine ranking* today. We
sell the agent-tooling surface, not GEO. A **hosted** MCP endpoint is also the only part
of this that moves ora's Agent Integration number; a docs MCP server earns partial credit
there (an endpoint exists, speaks JSON-RPC, returns clean errors) but does not satisfy the
"function-calling against product capabilities" intent — that belongs to c15t's own API,
not its docs.

## Principles / constraints

- **Layer, not backend.** Emit static files + *mountable handlers*. Never own a port,
  hosting, auth, or a long-lived process beyond a local dev stdio binary.
- **No UI, ever.** Rules out the UX dimension (`ui://` MCP Apps). Not in scope.
- **One source, zero drift.** Frontmatter + MDX already feed llms.txt, sitemaps, JSON-LD,
  `.md` pages, and the search index. Every new output is *another consumer of artifacts we
  already build* — never a parallel hand-maintained surface.
- **Unify the signal vocabulary.** `ai-train` / `search` / `ai-input` appears in both
  robots.txt and the `Content-Signal` response header. One config knob, two emitters.
- **MCP: build on SDK v1.x** (`@modelcontextprotocol/sdk`; v2 is pre-alpha). Ship **stdio +
  Streamable HTTP** transports only — **SSE is deprecated, do not emit it.** Tool input
  schemas via Valibot (already a dependency; SDK accepts Standard Schema).

## What already ships (baseline — do not rebuild)

- `llms.txt`, `docs/llms.txt`, `llms-full.txt` (spec-ish H1 + blockquote + sectioned links)
- `sitemap.xml` **and** `sitemap.md`, `robots.txt` (allow-list for a known AI-crawler set)
- `renderJsonLd()` → per-page `TechArticle` (runtime, via framework adapters)
- per-page `.md` (each page carries `markdownUrlPath` / `markdownAbsoluteUrl`)
- `search-index.json` (+ optional `search-content.json`), `agent-readability.json`
- `searchDocs()` query API + content store; `AGENTS.md` bundle mode
- Config via `defineDocsConfig` in `leadtype.config.ts`

## Components

### 1. Docs MCP server — `leadtype/mcp` (headline, net-new)

A thin adapter over the existing search index + content store. Two delivery shapes from one
generated module:

- **Local / IDE (stdio):** `leadtype mcp` — zero-arg binary reading the generated artifacts
  (`agent-readability.json` + `search-index.json` + `docs/*.md`). For Claude Desktop, Cursor,
  Cline, and version-matched docs in `node_modules/<pkg>`.
- **Remote / hostable (Streamable HTTP):** an exported `createMcpHandler()` returning a
  request handler the host mounts in its own route (Next/Astro/TanStack). This is the variant
  that registers on ora. **Host owns hosting** — we stay a layer.

```ts
// remote — host mounts at /mcp
import { createMcpHandler } from "leadtype/mcp";
export const POST = createMcpHandler({ artifacts: "./public" });
```

**Tools (the consensus minimal set — search + fetch, nothing more):**

- `search-docs(query: string, limit?: number)` → ranked `{ title, urlPath, snippet }[]`.
  Wraps the existing `searchDocs()` / `DocsSearchBundle`.
- `get-page(urlPath: string)` → full markdown of one page **read from the `.md` mirror on
  disk** (see Resolved decisions Q2).
- *(optional, behind a flag)* `list-pages()` → navigation tree from `agent-readability.json`.

**Onboarding DX:** `generate` emits a ready-to-paste client snippet artifact
(`docs/mcp.json` + a printed `claude_desktop_config.json` / `.cursor/mcp.json` block), so
wiring an agent is copy-paste. No runtime DB — the prebuilt index *is* the backend.

**Gate:** MCP is worth it for large corpora / SDK docs where agents want targeted retrieval.
For docs that fit in `llms-full.txt`, say so and let users skip it.

### 2. Content-negotiation handler + llms.txt discovery polish

We already emit the `.md` pages; what's missing is the *serving* primitive and discovery.

- **`createMarkdownNegotiationHandler()`** — mountable handler that branches on
  `Accept: text/markdown` and serves the pre-built `.md`, with the correctness headers the
  research flagged: **`Vary: Accept` (mandatory)**, `Content-Type: text/markdown; charset=utf-8`,
  `Content-Signal: …` (shared vocab, §3), optional `x-markdown-tokens`.
- **llms.txt discovery:** emit a `/.well-known/llms.txt` copy and the discovery headers
  (`Link: </llms.txt>; rel="llms-txt"`, `X-Llms-Txt: /llms.txt`) from the negotiation handler;
  add `<link rel="alternate" type="text/markdown">` guidance for adapters.
- **llms.txt spec polish:** support an explicit **`## Optional`** section (semantically "safe
  to drop for shorter context") — author-controlled via nav/frontmatter.

### 3. robots.txt AI-policy + Content-Signals

Today `renderRobotsTxt` emits allow-only rules for a fixed AI-crawler list. Upgrade to a
**policy-configurable** emitter:

- Model the 2026 **train-vs-retrieve** split: named groups for training crawlers (GPTBot,
  Google-Extended, CCBot, ByteSpider) vs. retrieval crawlers (OAI-SearchBot, ChatGPT-User,
  PerplexityBot, Googlebot).
- Emit a **Cloudflare Content-Signals** line (`search` / `ai-input` / `ai-train`).
- **Sane "balanced" default** (allow retrieval, training is the user's call) so the common
  case stays zero-config. Same vocabulary object feeds the `Content-Signal` header in §2.

### 4. JSON-LD entity graph + lint validation

Today: per-page `TechArticle` only, with an inline `isPartOf` WebSite. Upgrade to a small,
**referenced** entity graph (derived from `product` + frontmatter):

- Site-level, emitted once: `Organization` (canonical `@id`), `WebSite` + `potentialAction`
  → **`SearchAction`**, `SoftwareApplication` (or `SoftwareSourceCode` for libraries).
- Per-page: `TechArticle` (+ optional `APIReference` for reference pages) + `BreadcrumbList`,
  with `author`/`publisher` **referencing the shared `@id`s** — not re-inlined per page (avoids
  graph noise; lets answer engines build one entity graph).
- **`leadtype lint` gains a JSON-LD validity check** — broken schema is worse than none.

## Config surface

One additive `agents` block on `DocsConfig` (all optional, sane defaults — zero-config holds):

```ts
defineDocsConfig({
  product: { name, summary },
  agents: {
    mcp:    { enabled: true, tools: ["search-docs", "get-page"] },
    robots: { policy: "balanced", signals: { search: "yes", aiTrain: "no", aiInput: "yes" } },
    jsonLd: { organization: { name, url }, software: { applicationCategory } },
  },
});
```

## CLI surface

- **`leadtype mcp`** — new command; runs the stdio server over generated artifacts.
- **`leadtype generate`** — emits `/.well-known/llms.txt`, the MCP client snippet, the richer
  JSON-LD graph, and the policy-aware robots.txt. No new required flags; behavior driven by the
  `agents` config block. Possibly `--mcp` to force-emit the snippet without config.
- **`leadtype lint`** — adds JSON-LD validation.

## Non-goals (say so plainly)

- Running/hosting the MCP server, OAuth, or any auth — host's job.
- OpenAPI generation, the Auth & Access dimension, MCP *Apps* / `ui://` (needs UI).
- Moving ora's **Discovery** (answer-engine recall) — not something a docs tool emits.
- Selling any of this as a GEO/ranking lever.

## Phasing (within the one release)

1. ✅ **MCP server** (stdio + `createMcpHandler`, `search-docs` + `get-page`, bundle `--mcp`) —
   reuses `searchDocs()`; dogfooded in `apps/example`.
2. ✅ **Content-negotiation + llms.txt discovery** (`.well-known`, `Link`/`X-Llms-Txt` headers,
   `## Optional` section). The negotiation handler (`createAgentMarkdownResponse`) pre-existed.
3. ✅ **robots AI-policy + Content-Signals** (`balanced`/`open`/`block-training`/`block-ai`
   policy, shared `Content-Signal` vocab on robots.txt + markdown responses, `agents.robots`
   config knob).
4. ✅ **JSON-LD entity graph + lint validation** (referenced `@id`s, `renderSiteJsonLd`,
   APIReference auto-typing, `validateJsonLd` + the `jsonld` lint rule).

**All phases shipped** across a series of tested, committed steps — each with its own changeset
and docs. The `agents` config block (`agents.robots`, extensible to `jsonLd`) is the additive
config surface from the design.

## Resolved decisions

The four open questions, decided (grounded in the current code):

### Q1 · MCP SDK churn → pin `^1.x` as an *optional* peer dep; one transport-agnostic tool registry

- Add `@modelcontextprotocol/sdk` as an **optional `peerDependency`** (mirrors how `ai`,
  `fumadocs-core`, etc. are handled). It is **lazy `import()`-ed** only inside `leadtype mcp`
  and `createMcpHandler`; if absent we throw a clear "run `bun add @modelcontextprotocol/sdk`"
  error. Keeps it out of every install — layer principle holds, and the §1 gate ("skip MCP for
  small corpora") is respected by construction.
- Define tools **once** in `defineDocsTools(deps)` → `{ name, description, inputSchema (Valibot),
  handler }[]`. Both stdio and HTTP register from that single list. Valibot 1.4 is Standard-
  Schema-compliant, so a future v2 `registerTool`/Standard-Schema bump touches only the one
  registration adapter.
- *Resolved against SDK 1.29.0:* the typed `registerTool` `inputSchema` accepts **only Zod**
  (`AnySchema = z3.ZodTypeAny | z4.$ZodType`), not arbitrary Standard Schema. To avoid adding a
  Zod dependency, we use the **low-level `Server`** with `setRequestHandler` — tools advertise a
  hand-authored JSON Schema and validate args with Valibot inside the handler. The registry stays
  Zod-free; the v2 bump is the one `setRequestHandler` adapter.

### Q2 · `get-page` source of truth → read the `.md` mirror from disk (not the content store)

- `readDocsContentFile()` reconstructs page text by joining index *chunks* with `\n\n`
  (`search/search.ts:1146`) — lossy vs. the real page, and a second drift surface against what
  content-negotiation serves. The per-page `.md` files are the **canonical markdown surface**,
  and `createMarkdownNegotiationHandler` (§2) already serves exactly those.
- **Decision:** the search index is the **ranking** backend (`search-docs` snippets + scores);
  the **`.md` mirror is the content backend** (`get-page`). One content surface, byte-identical
  between MCP and content-negotiation. Look up the file via `agent-readability.json`'s
  `markdownUrlPath`, read it with the same `createPublicMarkdownReader` primitive
  (`internal/framework.ts:95`).

### Q3 · `createMcpHandler` framework matrix → one generic `(Request) => Promise<Response>`; Next recipe headline

- Every existing adapter (next, astro, tanstack-start, sveltekit, nuxt) already funnels through
  a generic `Request → Response` core (`internal/framework.ts:173`). `createMcpHandler()` returns
  the **same generic shape** (Streamable HTTP, stateless POST).
- **No per-framework MCP code.** Document the **Next route handler first** (matches the §1
  example), then a generic `Request → Response` snippet that the other four mount verbatim.
- *Resolved against SDK 1.29.0:* the SDK ships `WebStandardStreamableHTTPServerTransport`
  (`handleRequest(req: Request): Promise<Response>`) — a Web-standard transport, so no custom
  Node-`req/res` bridge is needed. We run it stateless (`sessionIdGenerator: undefined`) with
  `enableJsonResponse: true` (no SSE), building a fresh server + transport per request so
  concurrent requests never share transport state.

### Q4 · Bundle-mode MCP → shipped (opt-in `--mcp`)

**Shipped.** `leadtype generate --bundle --mcp` emits `search-index.json` +
`agent-readability.json` into the tarball, and `leadtype mcp --package <name>`
serves a dependency's version-matched docs (verified end-to-end + regression test).
Made it **opt-in** rather than unconditional (a small DX deviation from the original
resolution below): silently growing every consumer's tarball is a surprise, and the
flag matches the design's own "`--mcp` to force-emit" note. The artifacts are
URL-independent, so they need no `--base-url`.


- Shipping the stdio server inside the tarball is the strongest version-matching story (a
  consumer gets a docs MCP pinned to their installed version). **Decision: yes.**
- **Consequence:** today bundle mode emits *only* `AGENTS.md` + `docs/**/*.md` and **skips**
  `search-index.json` and `agent-readability.json` (`cli/generate.ts:1575`). A stdio server needs
  both (ranking + the page map). So bundle mode **also emits `search-index.json` +
  `agent-readability.json`** into the tarball's `docs/`. Both are small, derived, drift-free —
  no new authored surface. (This is the only resolution that changes tarball contents.)
- The `leadtype mcp` binary **auto-detects** artifact location: site (`./public/docs`) vs. bundled
  (`node_modules/<pkg>/docs`). Bundle-mode `.md` already uses relative links, consistent with
  `get-page` reading from disk.

## Implementation plan — Phase 1 (MCP server)

**Status: shipped + dogfooded.** stdio + `createMcpHandler` + `search-docs`/`get-page`
(+ optional `list-pages`), with unit tests, a real in-memory MCP client test, and a
built-binary stdio handshake all green.

**Dogfooded in `apps/example`** (TanStack Start): a Nitro middleware
(`server/middleware/mcp.ts`) mounts the docs MCP server at `POST /mcp`, and a `bun run mcp`
script serves the same docs over stdio. Both verified against the app's own 39 generated docs.

Two things surfaced during the build/dogfood and were fixed:
- The stdio server must wait for the transport to close (`server.connect` resolves on
  connect, not disconnect) or the CLI exits before answering a request.
- `createMcpHandler` originally took only a disk path. Dogfooding showed real apps already
  *bundle* the index + manifest (Vite/edge, no `fs` at request time), so it now also accepts
  in-memory artifacts via a new `createDocsArtifacts({ index, manifest, content, readMarkdown })`
  assembler. `apps/example` uses that path — reusing its bundled imports + existing Markdown
  reader, zero redundant disk reads.

New module `packages/leadtype/src/mcp/`:

- `artifacts.ts` — `loadDocsArtifacts({ artifacts })`: resolve + load `search-index.json` and
  `agent-readability.json`; expose a `.md` reader (reuses `createPublicMarkdownReader`). Handles
  site-vs-bundle auto-detection.
- `tools.ts` — `defineDocsTools(deps)`: `search-docs`, `get-page`, optional `list-pages`, with
  Valibot input schemas and handlers built on `searchDocs()` + the `.md` reader.
- `server.ts` — `createDocsMcpServer(options)`: build `McpServer` (lazy SDK import), register the
  tool list.
- `stdio.ts` — `runStdioServer(options)`: wire `StdioServerTransport`.
- `http.ts` — `createMcpHandler(config)` → `(Request) => Promise<Response>` via
  `StreamableHTTPServerTransport` (stateless).
- `index.ts` — public exports (`createMcpHandler`, `createDocsMcpServer`, types).

Wiring:

- `src/cli/mcp.ts` — `runMcpCommand` + `getMcpUsage`; register in `src/cli.ts` (import, usage,
  dispatch).
- `package.json` — add `./mcp` subpath export; add the optional `@modelcontextprotocol/sdk` peer
  dep (+ dev dep for build/test).
- Build config — ensure `src/mcp` is in the build entry set.

Deferred to later phase-1 sub-step: the `generate` client-snippet artifact (`docs/mcp.json` +
printed config block) and the bundle-mode emit change (Q4).
