---
title: '@inth/docs'
description: >-
  Reference map for the shared MDX conversion, linting, and LLM doc-generation
  package.
---
# `@inth/docs`

`@inth/docs` is the shared docs package for Inth properties. It provides:

* React MDX component adapters for doc sites.
* A remark pipeline that flattens MDX components into LLM-friendly markdown.
* MDX to markdown conversion utilities.
* `llms.txt` and topic-scoped `llms-full/*.txt` generators.
* MDX linting utilities for frontmatter, `meta.json`, and docs links.

## Package Surfaces

* [Components](/docs/components): React components and the `mdxComponents` adapter map.
* [Convert](/docs/convert): `convertMdxFile`, `convertSingleMdxFile`, and `convertAllMdx`.
* [Remark](/docs/remark): individual remark plugins plus `defaultRemarkPlugins`.
* [LLM](/docs/llm): `generateLLMSummaries` and `generateLLMFullFiles`.
* [Lint](/docs/lint): `lintDocs` and the `inth-docs-lint` CLI.

## When To Read Which Page

* Reach for [Components](/docs/components) when wiring MDX rendering into an app.
* Read [Convert](/docs/convert) when you need markdown output from `.mdx` files.
* Read [Remark](/docs/remark) when you need custom plugin order or component flattening behavior.
* Read [LLM](/docs/llm) when generating `llms.txt` or topic-scoped full-context bundles.
* Read [Lint](/docs/lint) when validating frontmatter, docs URLs, or sidebar metadata.
