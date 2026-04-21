# @inth/docs

Shared MDX-to-markdown tooling for Inth docs properties.

## Package Surfaces

- `@inth/docs`: React MDX component adapters via `mdxComponents`
- `@inth/docs/remark`: remark plugins plus `defaultRemarkPlugins`
- `@inth/docs/convert`: MDX-to-markdown conversion APIs
- `@inth/docs/llm`: `llms.txt` and topic-scoped full-context generation
- `@inth/docs/search`: headless static docs search, answer prompts, and request guards
- `@inth/docs/search/node`: Node-only search index generation
- `@inth/docs/search/ai`: Vercel AI SDK answer streaming helper
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

## Validation Layers

This package is verified in three distinct layers:

- Package unit tests in `packages/docs/src/**/*.test.ts*` cover pure library behavior such as semantic markup and safe-link handling.
- Pipeline fixtures in `apps/docs-smoke/scripts` and `apps/docs-smoke/content` exercise MDX conversion, LLM generation, and `AutoTypeTable`.
- The live consumer demo in `apps/docs-smoke` renders the exported `mdxComponents` inside a TanStack Start app and provides Playwright browser coverage.

Use the demo app as the reference integration when you need to see how a consumer should host and style the package in practice.

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
When the variable is absent, local builds fall back to `https://example.invalid/@inth/docs` so `bun run build` still succeeds in a clean workspace.

## Generate A Search Index

Run the MDX conversion first, then generate a static search index from the
converted markdown:

```ts
import { generateSearchIndex } from "@inth/docs/search/node";

await generateSearchIndex({
  outDir: "public",
  baseUrl: "https://docs.example.com",
});
```

At runtime, import the generated JSON and query it without Node APIs:

```ts
import { searchDocs, type DocsSearchIndex } from "@inth/docs/search";
import indexJson from "./public/docs/search-index.json";

const results = searchDocs(indexJson as DocsSearchIndex, "package tabs");
```

For question answering, use the AI helper with the Vercel AI SDK:

```ts
import { streamDocsAnswer } from "@inth/docs/search/ai";

const { response, sources } = streamDocsAnswer({
  index: indexJson as DocsSearchIndex,
  query: "How do I switch package managers?",
  model: process.env.DOCS_SEARCH_MODEL ?? "openai/gpt-5.4-mini",
  productName: "My Docs",
});
```

The search runtime includes reusable guards for payload size, query length,
control characters, client identification, and in-memory rate limiting. The
in-memory limiter is suitable for local demos; production apps should pass the
same `RateLimiter` interface through Redis, Vercel KV, Cloudflare KV, Durable
Objects, or another shared store.

The local index is the intended default for docs sites. It is static, cheap to
serve on Vercel and Cloudflare, and has no request-time database dependency.
Move to embeddings or hosted search when the index becomes large enough to hurt
cold starts, when docs exceed tens of thousands of chunks, or when semantic
recall matters more than exact docs terminology.
