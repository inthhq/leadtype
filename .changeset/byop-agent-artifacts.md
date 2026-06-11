---
"leadtype": minor
---

Add `generateAgentArtifacts()` to `leadtype/llm` — a bring-your-own-pages entry point that emits the full agent artifact set (llms.txt plus the `.well-known` copy, per-page Markdown mirrors at `${urlPath}.md` with `canonical_url`/`last_updated` frontmatter, sitemap.xml/sitemap.md, robots.txt with Content-Signals, and a root-level agent-readability manifest) from an in-memory page list instead of an `.mdx` docs tree, so CMS-backed blogs, marketing sites, and data-driven pages can publish agent artifacts without the docs pipeline. `emitRootCrawlerFiles: false` supports microfrontend fragments whose host app owns the origin-level crawler files. Root URL mounts (`urlPrefix: "/"`) now resolve correctly instead of emitting `//page` paths.
