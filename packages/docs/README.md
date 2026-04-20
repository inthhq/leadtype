# @inth/docs

Shared MDX-to-markdown tooling for Inth docs properties.

## Package Surfaces

- `@inth/docs`: React MDX component adapters via `mdxComponents`
- `@inth/docs/remark`: remark plugins plus `defaultRemarkPlugins`
- `@inth/docs/convert`: MDX-to-markdown conversion APIs
- `@inth/docs/llm`: `llms.txt` and topic-scoped full-context generation
- `@inth/docs/lint`: docs validation and the `inth-docs-lint` CLI

## Install

```bash
pnpm add @inth/docs
```

## Convert Docs

```ts
import { convertAllMdx } from "@inth/docs/convert";
import { defaultRemarkPlugins, remarkInclude } from "@inth/docs/remark";

await convertAllMdx({
  srcDir: "content",
  outDir: "public",
  remarkPlugins: [remarkInclude, ...defaultRemarkPlugins],
});
```

## Generate Agent Docs

Run:

```bash
INTH_DOCS_AGENT_BASE_URL=https://docs.example.com/@inth/docs bun run docs:agent
```

This writes a packaged reference bundle into `agent-docs/`.

## Bundled Agent References

The published package includes:

- `agent-docs/docs/llms.txt`
- `agent-docs/docs/components.md`
- `agent-docs/docs/convert.md`
- `agent-docs/docs/remark.md`
- `agent-docs/docs/llm.md`
- `agent-docs/docs/lint.md`

These files are intended for coding agents and other tooling that need small, topic-scoped references instead of a full docs site.

Set `INTH_DOCS_AGENT_BASE_URL` before generating publishable agent docs so the bundled routers point at the hosted docs base.
