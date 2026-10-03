# TanStack Start Example

The flagship reference and dogfood app for leadtype. Unlike the framework examples, it consumes the package's **own** docs — the repo-root `/docs` MDX — and exercises every surface: MDX rendering, a generated page manifest, build-time `llms.txt` / agent-readability artifacts, static search, and optional source-grounded AI answers across TanStack, Vercel, and Cloudflare providers.

## How it's wired

This app reads the package's real docs at the repo root `/docs`, not the shared fixture.

- `src/routes/docs/$.tsx` — the catch-all docs route. It loads `src/generated/docs-pages.json` (a manifest of every page) and uses `import.meta.glob("../../../../../docs/**/*.mdx")` to lazily resolve each page's MDX module by its `globKey`. MDX is compiled via `@mdx-js/rollup` plus `createMdxSourcePlugins` from `leadtype/mdx` (see `vite.config.ts`).
- `src/lib/docs.ts` — derives header tabs and sidebar sections from `src/generated/docs-nav.json`.
- `server/middleware/agent-readability.ts` — serves agent-readability behavior.
- `src/routes/api/docs/search.ts` and `src/routes/api/docs/ask/*.ts` — static search plus per-provider AI answer endpoints (`leadtype/search/tanstack`, `/vercel`, `/cloudflare`).
- `public/docs/*.md`, `public/llms.txt`, and `public/llms-full.txt` are generated `.md` mirrors and agent artifacts.

## Running it

```sh
bun run --filter tanstack dev
bun run --filter tanstack build
```

Both build the `leadtype` package, then run `pipeline:build`, then start/build via Vite. Local server scripts use `portless` for HTTPS on :443.

## What the build does

`pipeline:build` runs two steps:

1. `pipeline:generate` runs `leadtype generate` against the repo's docs config. It generates Markdown mirrors, search data, feeds, redirects, and agent artifacts, then copies the data the app imports into `src/generated/`.
2. `pipeline:source-manifest` loads the same config with `createDocsProject()` and writes the rendered-page manifest. It copies generated OpenAPI MDX into a stable directory for Vite and checks that runtime routes and navigation match the generated artifacts.

Both steps use the same deployment URL from `scripts/docs-project.ts`. Existing `pipeline:convert`, `pipeline:llm`, and `pipeline:search` commands remain aliases for generation so they cannot produce inconsistent partial output.

## Relationship to `leadtype init`

`leadtype init` does **not** scaffold this app — its generated page manifest, and per-provider AI routes are app-specific setup beyond the canonical integration. Follow the docs recipes instead: `use-the-source-primitive` under `/docs/pipeline` and `integrate-with-fumadocs` under `/docs/integrations`.
