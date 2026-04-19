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
bun run docs:agent
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

The generated `llms*.txt` files use `https://example.invalid/@inth/docs` as the default base URL. Regenerate with `INTH_DOCS_AGENT_BASE_URL` set if you want hosted links in those outputs.

## Repo Skill

This repo also includes a local agent skill at `.agents/skills/inth-docs/SKILL.md`. It routes agents to the packaged `agent-docs` bundle in `node_modules/@inth/docs/agent-docs` and falls back to the local workspace copy when the package is not installed.
