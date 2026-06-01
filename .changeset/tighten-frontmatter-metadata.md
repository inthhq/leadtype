---
"leadtype": minor
---

Tighten the default docs frontmatter metadata contract before launch.

The default lint schema now uses `status` for editorial page state, accepts
string `deprecated` messages, and adds `variants` plus `related` metadata for
same-topic equivalents and see-also links. The old page lifecycle fields
`deprecatedReason`, `experimental`, `canary`, `new`, `draft`, and
`availableIn` are no longer part of the default docs-page schema. Model release
channels with config or frontmatter transformers instead of source-authored page
status.
