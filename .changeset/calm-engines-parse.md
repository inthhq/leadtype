---
"leadtype": minor
---

Use Satteri and the native markdown pipeline for agent-facing markdown conversion.

`convertAllMdx`, `convertMdxFile`, `convertMdxToMarkdown`, and `leadtype generate` now parse MDX through Satteri and run native markdown transforms/stringification for agent-facing output.

The legacy agent-side Remark conversion path has been removed. This removes `markdownEngine`, the `leadtype/remark` compatibility export, and legacy aliases such as `defaultRemarkPlugins`, `legacyDefaultMarkdownTransforms`, and `builtinFlattenerPlugins`. Source-MDX bundler APIs under `leadtype/mdx` and `leadtype/mdx/source` remain intact.
