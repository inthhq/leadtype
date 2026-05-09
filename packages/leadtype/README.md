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

```bash
# In a repo with docs/*.mdx
npx leadtype generate --src . --out public --base-url https://docs.example.com
```

Output:

```
public/
├── llms.txt
└── docs/
    ├── *.md
    ├── llms.txt
    ├── llms-full/<group>.txt
    ├── search-index.json
    └── search-content.json
```

## Documentation

Full docs at [docs.example.com](https://docs.example.com/docs). Highlights:

- [Quickstart](https://docs.example.com/docs/quickstart) — five-minute happy path.
- [How it works](https://docs.example.com/docs/how-it-works) — the mental model.
- [Build a docs site](https://docs.example.com/docs/build/connect-docs-site) — wire into your build.
- [Bundle docs into a package](https://docs.example.com/docs/build/bundle-package-docs) — ship docs inside an npm tarball.
- [CLI reference](https://docs.example.com/docs/reference/cli) — every flag.

## Entry points

| Import | Purpose |
| --- | --- |
| `leadtype` | `defineDocsConfig` — the config helper. |
| `leadtype/convert` | MDX-to-markdown conversion. |
| `leadtype/remark` | `defaultRemarkPlugins` plus individual plugins. |
| `leadtype/llm` | `generateLlmsTxt`, `generateLLMFullContextFiles`, `resolveDocsNavigation`. |
| `leadtype/search` | Edge-safe search runtime, content readers, request guards. |
| `leadtype/search/node` | Build-time `generateDocsSearchFiles`. |
| `leadtype/search/vercel` | Vercel AI SDK / AI Gateway answer streaming and bash tools. |
| `leadtype/search/tanstack` | TanStack AI answer streaming and bash tools. |
| `leadtype/search/cloudflare` | Cloudflare AI Gateway / Workers AI adapter and bash tools. |
| `leadtype/lint` | `lintDocs` and the `leadtype lint` CLI. |

The `leadtype` binary wraps `generate` and `lint`. Use the library entry points when you need custom plugin order, base URL precedence, or alternate output paths.

## Bundled agent docs

This package ships its own docs inside the published tarball at `node_modules/leadtype/docs/`:

- `docs/llms.txt` — routing index
- `docs/llms-full/*.txt` — per-leaf-group full content
- `docs/*.md` — flattened markdown per page
- `docs/search-index.json` + `docs/search-content.json`

Agents and IDEs can read these offline. Set `LEADTYPE_AGENT_BASE_URL` before running `bun run docs:generate` so the URLs in `llms.txt` point to your hosted docs.

## License

MIT.
