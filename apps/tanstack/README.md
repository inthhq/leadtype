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

`pipeline:build` chains four scripts under `scripts/`:

1. `pipeline:convert` (`mdx-convert.ts`) — converts `/docs` MDX to markdown in `public/docs/` via `convertAllMdx` + remark plugins (`leadtype/convert`, `leadtype/remark`).
2. `pipeline:llm` (`llm-generate.ts`) — writes `public/llms.txt`, `public/llms-full.txt`, agent-readability artifacts, and `src/generated/docs-nav.json` via `leadtype/llm`.
3. `pipeline:search` (`search-generate.ts`) — writes the static search index/content via `generateDocsSearchFiles` from `leadtype/search/node`.
4. `pipeline:source-manifest` (`docs-source-manifest.ts`) — dogfoods `createDocsSource()` to write `src/generated/docs-pages.json`, the manifest the catch-all route binds slugs to MDX modules with.

## Relationship to `leadtype init`

`leadtype init` does **not** scaffold this app — its multi-script pipeline, generated page manifest, and per-provider AI routes are app-specific setup beyond the canonical integration. Follow the docs recipes instead: `use-the-source-primitive` and `integrate-with-fumadocs` under `/docs/build`.

## Real c15t Repro

The TanStack app includes opt-in scripts for testing Leadtype against the real
`c15t/c15t` docs tree. They clone a sparse fixture into
`content-fixtures/c15t/`, including both `docs/` and `packages/` so
`AutoTypeTable` references resolve like they do in the source repo.

```sh
C15T_REF=leadtype-docs-navigation-main bun run --filter tanstack pipeline:setup-real
bun run --filter tanstack pipeline:generate-real
bun run --filter tanstack pipeline:test-real
```

`pipeline:generate-real` runs the source-config driven `leadtype generate`
path against `content-fixtures/c15t/docs/docs.config.ts` and writes artifacts to
`apps/tanstack/public-real/`.
