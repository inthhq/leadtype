---
"leadtype": minor
---

Use Satteri as the default MDX parser for markdown conversion.

`convertAllMdx`, `convertMdxFile`, `convertMdxToMarkdown`, and `leadtype generate` now parse MDX through Satteri by default while continuing to run the existing remark plugin pipeline for component flattening and serialization. Pass `markdownEngine: "remark"`, `--markdown-engine remark`, or set `LEADTYPE_MARKDOWN_ENGINE=remark` to opt back into the previous parser.
