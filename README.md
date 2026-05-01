# @inth/docs

Shared docs tooling for Inth docs projects: framework-neutral MDX-to-markdown conversion, LLM bundles, validation, and static search.

`@inth/docs` is split into focused public entry points:

- `@inth/docs/remark`: remark plugins plus `defaultRemarkPlugins`
- `@inth/docs/convert`: MDX-to-markdown conversion APIs
- `@inth/docs/llm`: `llms.txt` and topic-scoped full-context generation
- `@inth/docs/search`: search runtime, content readers, guards, and rate limiter helpers
- `@inth/docs/search/node`: Node-only search index generation
- `@inth/docs/search/vercel`: Vercel AI Gateway / AI SDK answer streaming and bash tools
- `@inth/docs/search/tanstack`: TanStack AI answer streaming and bash tools
- `@inth/docs/search/cloudflare`: Cloudflare AI Gateway / Workers AI adapter helpers and bash tools
- `@inth/docs/lint`: docs validation and the `@inth/docs lint` CLI

## Install

```bash
pnpm add @inth/docs
```

## Basic Usage

### Own MDX components in your app

`@inth/docs` does not export prebuilt React, Vue, Nuxt, Svelte, or Astro components. Define the MDX component map in the docs app that renders your pages.

## Live Example App

The repo includes a canonical consumer demo at `apps/example`.

- Renders real `.mdx` fixture files through app-owned `mdxComponents`.
- Uses TanStack Start for SSR and hydration coverage.
- Shows extracted `ExtractedTypeTable` output while keeping pipeline fixtures in the validation path.

Local workflow:

```bash
bun install
bun run dev
```

Pipeline and browser checks:

```bash
bun run --filter example pipeline:build
bun run --filter example pipeline:test
bun run --filter example test:e2e
```

Validation layers:

- Package unit tests in `packages/docs/src/**/*.test.ts*` cover framework-neutral conversion, search, linting, and generated docs behavior.
- Pipeline fixtures in `apps/example/scripts` and `apps/example/content` cover MDX conversion, LLM generation, and `ExtractedTypeTable`.
- The TanStack Start demo app in `apps/example/src` covers real browser rendering and hydration.

## Where This Fits

`@inth/docs` is not a hosted docs platform or a complete docs-site framework. Use tools such as Mintlify, Fumadocs, or Starlight when the primary job is shipping a polished docs website quickly.

Use this package when the primary job is shared docs infrastructure: MDX-to-markdown conversion, LLM bundles, linting, static search artifacts, answer helpers, and agent-facing docs output that can feed multiple apps and tools.

The pipeline entry points are framework-neutral. React, Vue, Nuxt, Svelte, Astro, and other stacks can use conversion, LLM, lint, and search APIs while owning their own runtime component rendering.

## Wiring It Into An App

In a c15t-style repo with a top-level `docs/` directory, wire `@inth/docs` into the docs app and docs scripts:

- The docs app owns `mdxComponents` if it renders MDX directly.
- A conversion script runs `convertAllMdx({ srcDir: process.cwd(), outDir: "public" })`.
- LLM and search scripts read the converted markdown under `public/docs/`.
- Product code does not import `@inth/docs` unless it also renders docs pages.

### Convert MDX to markdown

```ts
import { convertAllMdx } from "@inth/docs/convert";
import { defaultRemarkPlugins, remarkInclude } from "@inth/docs/remark";

await convertAllMdx({
  srcDir: "content",
  outDir: "public",
  remarkPlugins: [remarkInclude, ...defaultRemarkPlugins],
});
```

### Generate agent-facing docs bundles

```ts
import { generateLLMFullContextFiles, generateLlmsTxt } from "@inth/docs/llm";
```

Source MDX for the package's own docs lives at the repo root in `/docs` (with `meta.json`). Run the docs generator locally with:

```bash
INTH_DOCS_AGENT_BASE_URL=https://docs.example.com/@inth/docs bun run --filter @inth/docs docs:generate
```

This converts `/docs/*.mdx` into `packages/docs/docs/` (markdown, `llms.txt`, `llms-full.txt`, `llms-full/`). The output folder is gitignored and produced fresh at build time; only the converted output ships in the published tarball — the `.mdx` source does not.

### Generate a static search index

```ts
import { generateDocsSearchFiles } from "@inth/docs/search/node";

await generateDocsSearchFiles({
  outDir: "public",
  baseUrl: "https://docs.example.com",
});
```

At runtime, query the generated JSON with `@inth/docs/search`. Add a provider entrypoint such as `@inth/docs/search/vercel` only when a user explicitly asks for a source-grounded answer.

## Agent Docs

The package ships a small, topic-scoped agent reference bundle in `docs/`:

- `docs/llms.txt`: routing index
- `docs/components.md`
- `docs/convert.md`
- `docs/remark.md`
- `docs/llm.md`
- `docs/search.md`
- `docs/lint.md`

Set `INTH_DOCS_AGENT_BASE_URL` to the hosted docs base before generating publishable `llms*.txt` files.
For the example app generator, base URL precedence is `INTH_DOCS_AGENT_BASE_URL`, then generic deployment `BASE_URL`, then `PORTLESS_URL`, then the local default.

## Repo Skill

This repo also includes a local agent skill at `.agents/skills/inth-docs/SKILL.md`. It routes agents to the packaged `docs` bundle in `node_modules/@inth/docs/docs` and falls back to the local workspace copy at `packages/docs/docs/` when the package is not installed.
