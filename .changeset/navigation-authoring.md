---
"leadtype": minor
---

Reduce navigation config churn for large and repeated docs trees.

A curated tree earns its cost while every entry is a decision. It stops earning it when a section is mostly inventory — twenty pages where three must lead and the rest could be alphabetical — because then every new page is added twice, on disk and in the config, and the two drift.

`navigation.fromDirectory()` (from `leadtype/navigation`) includes a directory without listing it, and the new `pin` option on include entries keeps the pages whose position is a decision at the front:

```ts
{
  title: "Concepts",
  base: "concepts",
  pages: navigation.fromDirectory(".", {
    pin: ["initialization-flow", "consent-models"],
    exclude: "internal-*",
  }),
}
```

Pinned pages lead in the order given; the rest follow in `sort` order, so adding a page appends it to the tail and never displaces a deliberate choice. Explicit refs and an expansion can share one `pages` array. A pin matching nothing is an error rather than a silent no-op — that is almost always a rename the config missed. Expansion still happens once during navigation resolution, so one resolved tree keeps driving the sidebar, `llms.txt`, `AGENTS.md`, the sitemap, and Agent Readability metadata.

`leadtype nav` prints the tree your config actually resolves to and reports drift: pages no curated entry places, pages two entries both claim, and pages whose `group:` names a group the config never declares. Human and `--json` output, per collection, read-only — it never writes config, moves content, or changes a public route.
