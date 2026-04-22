# @inth/docs

Shared docs tooling for Inth docs projects: React MDX rendering, MDX-to-markdown conversion, LLM bundles, validation, and static search.

`@inth/docs` is split into focused public entry points:

- `@inth/docs`: React MDX component adapters via `mdxComponents`
- `@inth/docs/remark`: remark plugins plus `defaultRemarkPlugins`
- `@inth/docs/convert`: MDX-to-markdown conversion APIs
- `@inth/docs/llm`: `llms.txt` and topic-scoped full-context generation
- `@inth/docs/search`: edge-safe search runtime, content readers, guards, and rate limiter helpers
- `@inth/docs/search/node`: Node-only search index generation
- `@inth/docs/search/ai`: AI SDK answer streaming helper
- `@inth/docs/search/bash`: optional bash-tool docs inspection adapter
- `@inth/docs/lint`: docs validation and the `inth-docs-lint` CLI

## Install

```bash
pnpm add @inth/docs
```

## Basic Usage

### Render MDX components

```tsx
import { mdxComponents } from "@inth/docs";

const components = {
  ...mdxComponents,
};
```

## Live Example App

The repo includes a canonical consumer demo at `apps/docs-smoke`.

- Renders real `.mdx` fixture files through the package's exported `mdxComponents`.
- Uses TanStack Start for SSR and hydration coverage.
- Shows extracted `ExtractedTypeTable` output while keeping pipeline fixtures in the validation path.

Local workflow:

```bash
bun install
bun run demo:dev
```

Pipeline and browser checks:

```bash
bun run --filter docs-smoke pipeline:build
bun run --filter docs-smoke pipeline:test
bun run --filter docs-smoke test:e2e
```

Validation layers:

- Package unit tests in `packages/docs/src/**/*.test.ts*` cover component semantics and pure library behavior.
- Pipeline fixtures in `apps/docs-smoke/scripts` and `apps/docs-smoke/content` cover MDX conversion, LLM generation, and `ExtractedTypeTable`.
- The TanStack Start demo app in `apps/docs-smoke/src` covers real browser rendering and hydration.

## Where This Fits

`@inth/docs` is not a hosted docs platform or a complete docs-site framework. Use tools such as Mintlify, Fumadocs, or Starlight when the primary job is shipping a polished docs website quickly.

Use this package when the primary job is shared docs infrastructure: MDX rendering adapters, MDX-to-markdown conversion, LLM bundles, linting, static search artifacts, answer helpers, and agent-facing docs output that can feed multiple apps and tools.

## Wiring It Into An App

In a c15t-style repo with a top-level `docs/` directory, wire `@inth/docs` into the docs app and docs scripts:

- The docs app imports `mdxComponents` only if it renders MDX directly.
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

Run the packaged agent-doc generator locally with:

```bash
INTH_DOCS_AGENT_BASE_URL=https://docs.example.com/@inth/docs bun run docs:agent
```

This writes a bundled reference set into `packages/docs/agent-docs/`.

### Generate a static search index

```ts
import { generateDocsSearchFiles } from "@inth/docs/search/node";

await generateDocsSearchFiles({
  outDir: "public",
  baseUrl: "https://docs.example.com",
});
```

At runtime, query the generated JSON with `@inth/docs/search`. Add `@inth/docs/search/ai` only when a user explicitly asks for a source-grounded answer.

## Agent Docs

The package now ships a small, topic-scoped agent reference bundle:

- `agent-docs/docs/llms.txt`: routing index
- `agent-docs/docs/components.md`
- `agent-docs/docs/convert.md`
- `agent-docs/docs/remark.md`
- `agent-docs/docs/llm.md`
- `agent-docs/docs/search.md`
- `agent-docs/docs/lint.md`

Set `INTH_DOCS_AGENT_BASE_URL` to the hosted docs base before generating publishable `llms*.txt` files.

## Repo Skill

This repo also includes a local agent skill at `.agents/skills/inth-docs/SKILL.md`. It routes agents to the packaged `agent-docs` bundle in `node_modules/@inth/docs/agent-docs` and falls back to the local workspace copy when the package is not installed.
