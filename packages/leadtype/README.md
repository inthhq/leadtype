# leadtype

A docs pipeline. Write MDX once. Get a website, agent-readable bundles, and a static search index from a single command.

- Flattens MDX components into clean markdown that agents and tools can read.
- Generates `llms.txt`, markdown mirrors, and a root `llms-full.txt` fallback.
- Builds a static, edge-safe search index (BM25, optional source-grounded answers).
- Validates frontmatter, navigation, and internal links.

leadtype is not a docs website framework. Bring your own UI — Next.js, TanStack Start, Astro, anything.

## Install

```bash
pnpm add leadtype
```

## 30-second example

For a hosted docs site:

```bash
npx leadtype generate --src . --out public --base-url https://leadtype.dev
# → public/llms.txt, public/llms-full.txt, public/docs/*.md,
#   public/docs/search-index.json
```

For an npm-bundled doc set:

```bash
npx leadtype generate --bundle --src . --out packages/my-package
# → packages/my-package/AGENTS.md, packages/my-package/docs/*.md
```

The website output is fetched by humans (HTML) and HTTP agents (`Accept: text/markdown` or `/llms.txt`). The bundled output lives at `node_modules/<your-pkg>/AGENTS.md` after install so consumers can point coding agents at version-matched offline docs.

## Documentation

Full docs at [leadtype.dev](https://leadtype.dev/docs). Highlights:

- [Quickstart](https://leadtype.dev/docs/quickstart) — five-minute happy path.
- [How it works](https://leadtype.dev/docs/how-it-works) — the mental model.
- [Build a docs site](https://leadtype.dev/docs/pipeline/build-a-docs-site) — wire into your build.
- [Bundle docs into a package](https://leadtype.dev/docs/package-docs/bundle) — ship docs inside an npm tarball.
- [Add search](https://leadtype.dev/docs/search/add-search) — generate and query the static search index.
- [CLI reference](https://leadtype.dev/docs/reference/cli) — every flag.

## Entry points

| Import | Purpose |
| --- | --- |
| `leadtype` | `defineDocsConfig` — the config helper. |
| `leadtype/convert` | MDX-to-markdown conversion. |
| `leadtype/mdx` | Source-MDX tag types, include helpers, and `createMdxSourcePlugins()`. |
| `leadtype/markdown` | `defaultMarkdownTransforms` plus individual plugins. |
| `leadtype/llm` | `generateLlmsTxt`, `generateLLMFullContextFiles`, `generateAgentsMd`, `resolveDocsNavigation`. |
| `leadtype/search` | Edge-safe search runtime, content readers, request guards. |
| `leadtype/search/node` | Build-time `generateDocsSearchFiles`. |
| `leadtype/search/bash` | Read-only docs bash adapters for AI tools. |
| `leadtype/search/vercel` | Vercel AI SDK / AI Gateway answer streaming. |
| `leadtype/search/tanstack` | TanStack AI answer streaming. |
| `leadtype/search/cloudflare` | Cloudflare AI Gateway / Workers AI adapter. |
| `leadtype/lint` | `lintDocs` and the `leadtype lint` CLI. |
| `leadtype/mcp` | Docs MCP server — `createMcpHandler` (Streamable HTTP), `runStdioServer`, `createDocsArtifacts`, plus the `leadtype mcp` CLI. |
| `leadtype/score` | `scoreDocs` — the agent-readiness score behind the `leadtype score` CLI. |
| `leadtype/fumadocs` | Adapter mapping `createDocsSource()` to fumadocs's `Source` interface. |
| `leadtype/next` | Next.js App Router server adapter — `createDocsRouteHandler`, `createGenerateStaticParams`, `createLoadPageData`. |
| `leadtype/next/client` | Next.js client hook — `useLeadtypeSearch` and the framework-free `createSearchClient`. |

Framework adapters are thin and ship **state and routing primitives only** — no rendered DOM. See the [architecture reference](https://leadtype.dev/docs/reference/architecture) for the boundary contract and how to add more frameworks (`leadtype/nuxt`, `leadtype/sveltekit`, `leadtype/astro`, `leadtype/tanstack-start`, `leadtype/search/vue`, and `leadtype/search/svelte` are tracked under [#41](https://github.com/inthhq/leadtype/issues/41) / [#45](https://github.com/inthhq/leadtype/issues/45)).

The `leadtype` binary wraps `init`, `generate`, `sync`, `lint`, `mcp`, and `score`. Use the library entry points when you need custom plugin order, base URL precedence, or alternate output paths.

## Bundled agent docs

This package ships its own docs inside the published tarball:

- `AGENTS.md` at the package root — a version-matched entry point for coding agents reading the installed package from disk.
- `docs/*.md` — flattened markdown per page, organized by group.

After `npm install leadtype`, point your project's root `AGENTS.md` at the bundled docs:

```md
When working with the `leadtype` library, read
`node_modules/leadtype/AGENTS.md` first — it points at version-matched
markdown topic files.
```

Website URL artifacts (`llms.txt`, root `llms-full.txt`, sitemap, robots) are emitted only in default `leadtype generate` mode. Package bundles stay filesystem-first; when `docs.config.ts` sets `agents.mcp.enabled`, they also include the local search/readability files needed by `leadtype mcp --package`.

## License

MIT.
