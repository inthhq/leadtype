---
"leadtype": minor
---

Expand `leadtype lint`'s internal link coverage (closes the gaps tracked in
#86):

- **Relative links** (`./sibling`, `../guides/x`, extension optional) resolve
  against their source file and validate like absolute links; links that
  climb out of the docs tree are errors.
- **Anchor validation** (new `invalid-anchor` rule): same-page `#fragment`
  links and fragments on cross-page docs links must match a heading anchor on
  the target page. Anchors are extracted from the rendered markdown with the
  same slugger and duplicate handling that builds the site TOC — includes
  expanded — so lint and the rendered site cannot disagree. (Running this on
  leadtype's own docs immediately found three anchors that had been silently
  broken on the live site.)
- **Redirect-aware messages**: with redirect tracking enabled, an
  `invalid-link` whose target matches a lockfile redirect reports
  "moved to `<new path>` — update the link" instead of a bare missing-route
  error.
- Link-check scope and non-goals are documented in the lint reference.
