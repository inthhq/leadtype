---
"leadtype": minor
---

Add `sourceConfig` inheritance for remote collections, making the pinned source
docs UI path first-class.

Docs UI repos can now set `sourceConfig: true` on a remote `defineCollection`
to load `docs.config.{ts,js,mjs,cjs}` from the synced source collection and
inherit source-owned `navigation`, legacy `groups`, `frontmatterSchema`, and
`flatteners`. Explicit collection fields in the docs UI repo still win, while
site-owned fields such as `product`, `organization`, `agents`, `llms`, output
paths, and framework routes stay in the UI repo.

Use this when a package/source repo owns MDX and docs semantics, but a separate
docs UI repo owns rendering, deployment, and a reviewed source `ref`.
