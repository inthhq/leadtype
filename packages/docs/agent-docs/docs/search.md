---
title: Search
description: >-
  Generate and query a static docs search index, then stream source-grounded AI
  answers.
---
# Search

Import runtime helpers from:

```ts
import {
  createAnswerContext,
  createMemoryRateLimiter,
  readJsonWithLimit,
  searchDocs,
  validateDocsQuery,
} from "@inth/docs/search";
```

Import the Node-only generator from:

```ts
import { generateSearchIndex } from "@inth/docs/search/node";
```

Import the AI SDK helper from:

```ts
import { streamDocsAnswer } from "@inth/docs/search/ai";
```

## Build-Time Indexing

Generate the index after converting MDX to markdown:

```ts
await generateSearchIndex({
  outDir: "public",
  baseUrl: "https://docs.example.com",
});
```

The generator reads markdown under `{outDir}/docs` and writes
`{outDir}/docs/search-index.json`.

## Runtime Search

The core runtime is edge-safe. Import the generated JSON and query it directly:

```ts
const results = searchDocs(indexJson as DocsSearchIndex, "tabs install");
```

Search uses normalized tokens, a small stopword list, heading-aware chunks, and
BM25-style ranking. Titles and headings are weighted above body text; code is
searchable with a lower weight.

## Answer Context

Use `createAnswerContext` when wiring a custom model call:

```ts
const context = createAnswerContext(indexJson as DocsSearchIndex, query, {
  productName: "My Docs",
});
```

The returned `system` and `prompt` instruct the model to answer only from
retrieved docs context, cite sources with `[1]` style citations, treat docs text
as untrusted reference content, and say when context is insufficient.

## AI SDK Streaming

Use `streamDocsAnswer` for a minimal Vercel AI SDK integration:

```ts
const { response, sources } = streamDocsAnswer({
  index: indexJson as DocsSearchIndex,
  query,
  model: process.env.DOCS_SEARCH_MODEL ?? "openai/gpt-5.4-mini",
  productName: "My Docs",
});
```

The response is a plain text stream from `toTextStreamResponse()`. Display
`sources` separately in your own UI.

## Abuse Guards

The package includes reusable request-path utilities:

* `validateDocsQuery` trims and caps query text.
* `readJsonWithLimit` rejects oversized JSON bodies before parsing.
* `getClientIdentifier` reads common proxy IP headers.
* `createMemoryRateLimiter` implements the `RateLimiter` interface for demos.

In-memory rate limiting is not strong across serverless instances. Production
docs sites should adapt the `RateLimiter` interface to a shared store such as
Redis, Vercel KV, Cloudflare KV, or Durable Objects.

## When To Use Embeddings

Start with the local index for most docs sites. It is static, cheap, portable to
Vercel and Cloudflare, and has no request-time database dependency. Add
embeddings or hosted search when your docs reach very large chunk counts, when
cold-start memory becomes a problem, or when users need semantic matches that do
not share vocabulary with the docs.
