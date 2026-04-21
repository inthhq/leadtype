# @inth/docs

Shared MDX-to-markdown tooling for Inth docs properties.

`@inth/docs` is split into five main surfaces:

- `@inth/docs`: React MDX component adapters via `mdxComponents`
- `@inth/docs/remark`: remark plugins plus `defaultRemarkPlugins`
- `@inth/docs/convert`: MDX-to-markdown conversion APIs
- `@inth/docs/llm`: `llms.txt` and topic-scoped full-context generation
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
- Shows extracted `AutoTypeTable` output while keeping pipeline fixtures in the validation path.

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
- Pipeline fixtures in `apps/docs-smoke/scripts` and `apps/docs-smoke/content` cover MDX conversion, LLM generation, and `AutoTypeTable`.
- The TanStack Start demo app in `apps/docs-smoke/src` covers real browser rendering and hydration.

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
import { generateLLMFullFiles, generateLLMSummaries } from "@inth/docs/llm";
```

Run the packaged agent-doc generator locally with:

```bash
INTH_DOCS_AGENT_BASE_URL=https://docs.example.com/@inth/docs bun run docs:agent
```

This writes a bundled reference set into `packages/docs/agent-docs/`.

## Agent Docs

The package now ships a small, topic-scoped agent reference bundle:

- `agent-docs/docs/llms.txt`: routing index
- `agent-docs/docs/components.md`
- `agent-docs/docs/convert.md`
- `agent-docs/docs/remark.md`
- `agent-docs/docs/llm.md`
- `agent-docs/docs/lint.md`

Set `INTH_DOCS_AGENT_BASE_URL` to the hosted docs base before generating publishable `llms*.txt` files.

## Repo Skill

This repo also includes a local agent skill at `.agents/skills/inth-docs/SKILL.md`. It routes agents to the packaged `agent-docs` bundle in `node_modules/@inth/docs/agent-docs` and falls back to the local workspace copy when the package is not installed.
