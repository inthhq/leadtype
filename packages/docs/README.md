# @inth/docs

Framework-neutral docs pipeline tooling for Inth docs projects.

## Package Surfaces

- `@inth/docs/remark`: remark plugins plus `defaultRemarkPlugins`
- `@inth/docs/convert`: MDX-to-markdown conversion APIs
- `@inth/docs/llm`: `llms.txt` and topic-scoped full-context generation
- `@inth/docs/search`: headless static docs search, answer prompts, request guards, and rate limiter helpers
- `@inth/docs/search/node`: Node-only search index generation
- `@inth/docs/search/vercel`: Vercel AI Gateway / AI SDK answer streaming and bash tools
- `@inth/docs/search/tanstack`: TanStack AI answer streaming and bash tools
- `@inth/docs/search/cloudflare`: Cloudflare AI Gateway / Workers AI adapter helpers and bash tools
- `@inth/docs/lint`: docs validation and the `@inth/docs lint` CLI

## Install

```bash
pnpm add @inth/docs
```

## Convert Docs

`@inth/docs` does not export prebuilt UI components. The docs app owns its MDX component map and styling; this package owns the framework-neutral conversion, LLM, lint, and search pipeline:

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

- Package unit tests in `packages/docs/src/**/*.test.ts*` cover pure library behavior such as conversion, search, linting, and generated docs output.
- Pipeline fixtures in `apps/example/scripts` and `apps/example/content` exercise MDX conversion, LLM generation, and `ExtractedTypeTable`.
- The live consumer demo in `apps/example` owns and renders its MDX components inside a TanStack Start app and provides Playwright browser coverage.

Use the demo app as the reference integration when you need to see how a consumer should host and style the package in practice.

## Where This Fits

`@inth/docs` is portable docs infrastructure, not a hosted docs platform or complete docs-site framework. Mintlify, Fumadocs, and Starlight are good fits when the primary job is shipping the public docs website.

Use `@inth/docs` when the docs pipeline also needs to feed converted markdown, agent bundles, lint checks, static search data, source-grounded answer routes, and internal tooling while the consuming app keeps control of routing, layout, hosting, and framework choices.

React, Vue, Nuxt, Svelte, Astro, and other stacks can use the framework-neutral pipeline APIs today while owning their own runtime component rendering.

## App Wiring Model

In a consuming repo, wire this package into the docs surface:

- Runtime docs app: define `mdxComponents` in the app when it renders MDX directly.
- Docs pipeline: run `convertAllMdx` against the docs source tree.
- Agent output: run `generateLlmsTxt` and `generateLLMFullContextFiles` against the converted markdown.
- Search output: run `generateDocsSearchFiles`, then import the generated JSON in your docs search route.

Do not add `@inth/docs` to product runtime code unless that runtime also renders or serves documentation.

## Generate Agent Docs

The MDX source for this package's docs lives at the repo root in `/docs` (with `meta.json`). Run:

```bash
INTH_DOCS_AGENT_BASE_URL=https://docs.example.com/@inth/docs bun run docs:generate
```

This reads `/docs/*.mdx` and writes converted markdown plus `llms*.txt` bundles into `packages/docs/docs/`. The output folder is gitignored and produced fresh at build time; only the converted output ships in the published tarball — the `.mdx` source does not.

## Bundled Agent References

The published package includes:

- `docs/llms.txt`
- `docs/components.md`
- `docs/convert.md`
- `docs/remark.md`
- `docs/llm.md`
- `docs/search.md`
- `docs/lint.md`

These files are intended for coding agents and other tooling that need small, topic-scoped references instead of a full docs site.

Set `INTH_DOCS_AGENT_BASE_URL` before generating publishable agent docs so the bundled routers point at the hosted docs base.
For the example app generator, base URL precedence is `INTH_DOCS_AGENT_BASE_URL`, then generic deployment `BASE_URL`, then `PORTLESS_URL`, then the local default.
When the variable is absent, local builds fall back to `https://example.invalid/@inth/docs` so `bun run build` still succeeds in a clean workspace.

## Generate A Search Index

Run the MDX conversion first, then generate a static search index from the
converted markdown:

```ts
import { generateDocsSearchFiles } from "@inth/docs/search/node";

await generateDocsSearchFiles({
  outDir: "public",
  baseUrl: "https://docs.example.com",
});
```

At runtime, import the generated JSON and query it without Node APIs:

```ts
import {
  readDocsContentFile,
  searchDocs,
  type DocsSearchContentStore,
  type DocsSearchIndex,
} from "@inth/docs/search";
import contentJson from "./public/docs/search-content.json";
import indexJson from "./public/docs/search-index.json";

const index = indexJson as DocsSearchIndex;
const content = contentJson as DocsSearchContentStore;

const results = searchDocs(index, "package tabs", { content });
const quickstart = readDocsContentFile(
  index,
  "guides/quickstart",
  content
);
```

The generator writes a compact `search-index.json` plus a separate
`search-content.json`. Search scores against numeric chunk records, while answer
flows read precise docs pages or heading chunks from the content store.

For question answering, use a provider entrypoint. The example app uses the Vercel AI Gateway / AI SDK helper:

```ts
import { streamDocsAnswer } from "@inth/docs/search/vercel";

const { response, sources } = streamDocsAnswer({
  index,
  content,
  query: "How do I switch package managers?",
  model: process.env.DOCS_SEARCH_MODEL ?? "openai/gpt-5.4-mini",
  productName: "My Docs",
});
```

For agent-style docs inspection, use the provider-compatible bash tool adapter:

```ts
import { createDocsBashTool } from "@inth/docs/search/vercel";

const { tools, instructions } = await createDocsBashTool(index, content);
```

The bash adapter builds a read-only `/docs` filesystem for `just-bash` and wraps
it with `bash-tool` so AI SDK agents can inspect docs with commands like `ls`,
`cat`, `find`, `grep`, and `rg`.

Use `@inth/docs/search/tanstack` with a TanStack `adapter`, or
`@inth/docs/search/cloudflare` with `createCloudflareDocsAdapter`, when those
gateways own answer generation. Tools and tool instructions are explicit inputs
to `streamDocsAnswer`; no provider entrypoint creates tools internally.

The search runtime includes reusable guards for payload size, query length,
control characters, client identification, and in-memory rate limiting. The
in-memory limiter is suitable for local demos; production apps should pass the
same `RateLimiter` interface through Redis, Vercel KV, Cloudflare KV, Durable
Objects, or another shared store.

The local index is the intended default for docs sites. It is static, cheap to
serve on Vercel and Cloudflare, and has no request-time database dependency.
For larger docs, keep this lexical index for exact API/config/error searches and
add a virtual content layer plus optional embeddings for fuzzy semantic recall.
Move to hosted search or a vector store when the compact index becomes large
enough to hurt cold starts, docs exceed tens of thousands of chunks, or users ask
questions that do not share vocabulary with the docs.
