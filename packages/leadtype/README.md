# leadtype

A docs pipeline. Write MDX once. Get a website, agent-readable bundles, and a static search index from a single command.

- Flattens MDX components into clean markdown that agents and tools can read.
- Generates `llms.txt` plus topic-scoped full-context bundles.
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
# → public/llms.txt, public/docs/*.md, public/docs/llms-full/*.txt,
#   public/docs/search-index.json
```

For an npm-bundled doc set:

```bash
npx leadtype generate --bundle --src . --out packages/my-package
# → packages/my-package/AGENTS.md, packages/my-package/docs/*.md
```

The website output is fetched by humans (HTML) and HTTP agents (`Accept: text/markdown` or `/llms.txt`). The bundled output is auto-discovered by [25+ coding agents](https://agents.md) (Claude Code, Codex, Cursor, Copilot, …) when the package is installed at `node_modules/<your-pkg>/AGENTS.md`.

## Documentation

Full docs at [leadtype.dev](https://leadtype.dev/docs). Highlights:

- [Quickstart](https://leadtype.dev/docs/quickstart) — five-minute happy path.
- [How it works](https://leadtype.dev/docs/how-it-works) — the mental model.
- [Build a docs site](https://leadtype.dev/docs/build/connect-docs-site) — wire into your build.
- [Bundle docs into a package](https://leadtype.dev/docs/build/bundle-package-docs) — ship docs inside an npm tarball.
- [CLI reference](https://leadtype.dev/docs/reference/cli) — every flag.

## Entry points

| Import | Purpose |
| --- | --- |
| `leadtype` | `defineDocsConfig` — the config helper. |
| `leadtype/convert` | MDX-to-markdown conversion. |
| `leadtype/remark` | `defaultRemarkPlugins` plus individual plugins. |
| `leadtype/llm` | `generateLlmsTxt`, `generateLLMFullContextFiles`, `generateAgentsMd`, `resolveDocsNavigation`. |
| `leadtype/search` | Edge-safe search runtime, content readers, request guards. |
| `leadtype/search/node` | Build-time `generateDocsSearchFiles`. |
| `leadtype/search/bash` | Read-only docs bash adapters for AI tools. |
| `leadtype/search/vercel` | Vercel AI SDK / AI Gateway answer streaming. |
| `leadtype/search/tanstack` | TanStack AI answer streaming. |
| `leadtype/search/cloudflare` | Cloudflare AI Gateway / Workers AI adapter. |
| `leadtype/lint` | `lintDocs` and the `leadtype lint` CLI. |

The `leadtype` binary wraps `generate` and `lint`. Use the library entry points when you need custom plugin order, base URL precedence, or alternate output paths.

## Bundled agent docs

This package ships its own docs inside the published tarball:

- `AGENTS.md` at the package root — auto-discovered by [25+ coding agents](https://agents.md) when leadtype is installed in any project.
- `docs/*.md` — flattened markdown per page, organized by group.

After `npm install leadtype`, point your project's root `AGENTS.md` at the bundled docs:

```md
When working with the `leadtype` library, read
`node_modules/leadtype/AGENTS.md` first — it points at version-matched
markdown topic files.
```

The website-style outputs (`llms.txt`, `llms-full/*.txt`, `search-index.json`) are emitted only in default `leadtype generate` mode. They're served from a hosted docs site, not from the package tarball.

## License

MIT.
