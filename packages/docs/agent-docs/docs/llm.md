---
title: LLM
description: How to generate llms.txt and topic-scoped full-context files from @inth/docs.
---
# LLM

Import from:

```ts
import {
  generateLLMFullFiles,
  generateLLMSummaries,
} from "@inth/docs/llm";
```

This surface reads source docs and generated markdown to produce agent-friendly indexes and deep-context bundles.

## Output Model

### `generateLLMSummaries`

Creates:

* `/llms.txt`
* `/docs/llms.txt` when `docsSections` is provided

Use it to publish a short product summary plus a curated docs map.

### `generateLLMFullFiles`

Creates:

* `/llms-full.txt`
* `/docs/llms-full.txt`
* `/docs/llms-full/*.txt` topic files

Use it after markdown conversion. It reads `.md` files under `{outDir}/docs/`.

## Required Conventions

* Source docs for summaries live under `{srcDir}/docs/`.
* Converted markdown for full files lives under `{outDir}/docs/`.
* Run `convertAllMdx` before `generateLLMFullFiles`.

## Typical Sequence

```ts
await convertAllMdx({
  srcDir,
  outDir,
  remarkPlugins: [remarkInclude, ...defaultRemarkPlugins],
});

await generateLLMSummaries({
  srcDir,
  outDir,
  baseUrl,
  product: {
    name: "My Docs",
    summary: "Short product summary.",
  },
  docsSections: [
    {
      title: "Guides",
      links: [{ urlPath: "/docs/guides/quickstart" }],
    },
  ],
});

await generateLLMFullFiles({
  outDir,
  baseUrl,
  product: { name: "My Docs" },
  topics: [
    {
      slug: "guides",
      title: "Guides",
      description: "Full context for guides.",
      includePrefixes: ["guides/"],
    },
  ],
});
```

## Topic Design

Prefer multiple narrow topics over one giant full-context file.

* Good: `frameworks`, `self-host`, `integrations`
* Poor: one catch-all topic for the whole docs tree

The APIs support nested routers, so parent topics can point to smaller child topics.

## Guidance

* Keep curated summary links opinionated. They should help an agent choose the smallest useful file.
* Write short, explicit descriptions for topics and sections. Those descriptions become routing hints.
* If generated files are empty, check that the docs really live under the expected `docs/` folder names.
