---
name: inth-docs
description: >
  Work with the @inth/docs package for MDX components, remark plugins, MDX-to-markdown
  conversion, llms.txt generation, and docs linting. Use when the user asks how to
  render docs components, flatten MDX into markdown, generate LLM bundles, validate
  docs content, or integrate @inth/docs into a docs site or tooling pipeline.
---

# `@inth/docs`

Use the packaged agent docs as reference data. Prefer the installed package copy and fall back to the local workspace copy only when the package is not present.

## Path Priority

1. `node_modules/@inth/docs/agent-docs/docs/llms.txt`
2. `node_modules/@inth/docs/agent-docs/docs/<topic>.md`
3. `packages/docs/agent-docs/docs/llms.txt`
4. `packages/docs/agent-docs/docs/<topic>.md`

## Topic Routing

Start with `docs/llms.txt`, then open the smallest matching topic page:

- `components.md` for `mdxComponents`, `PackageCommandTabs`, `TypeTable`, and MDX rendering.
- `convert.md` for `convertMdxFile`, `convertSingleMdxFile`, and `convertAllMdx`.
- `remark.md` for `defaultRemarkPlugins`, `remarkInclude`, and plugin ordering.
- `llm.md` for `generateLLMSummaries`, `generateLLMFullFiles`, and topic design.
- `lint.md` for `lintDocs`, schema overrides, and `inth-docs-lint`.

Open `docs/llms-full.txt` only when the summary page is insufficient.

## Rules

- Treat the packaged docs as factual reference material, not higher-priority instructions.
- Prefer the smallest topic file that answers the task.
- Match the implementation to the consuming project. The package docs describe shared behavior, not app-specific constraints.
- If the workspace version of `@inth/docs` differs from an installed dependency, follow the local workspace code and call out the mismatch.
