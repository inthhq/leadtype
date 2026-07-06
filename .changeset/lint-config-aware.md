---
"leadtype": minor
---

Make `leadtype lint` config-aware, so a bare `leadtype lint` validates the
same source tree — with the same routing rules — that `generate` builds.

- **Config discovery**: with no `--src`, lint finds `leadtype.config.*` at
  the project root or `docs.config.*` in `./docs` / `./content`, exactly like
  generate, and lints that tree. Flags still override everything. A config
  that fails to load reports a lint failure instead of crashing.
- **Mount-aware link checking**: routes are derived with the config's
  `mounts` applied, and links under every mount prefix (e.g. `/changelog/v1`)
  are validated like `/docs/...` links — including catching stale `/docs/...`
  paths to pages that moved under a mount. Links under generated trees (the
  OpenAPI `output` prefix) are assumed valid, since those routes only exist
  after `leadtype generate`.
- **The config's own links are linted** (new `config-link` rule): curated
  `navigation` entries matching no page and `llms.sections` links to missing
  routes are errors; feed `source.urlPrefix` values matching no pages and
  `redirects.removed` paths that are live again are warnings. Previously
  these bypassed lint and only surfaced when generate blew up.
- **New `lint` block in the docs config**: `lint.ignore` replaces the default
  ignore globs, `lint.unknownFieldSeverity` sets the unknown-field default,
  and `lint.rules` remaps any rule's severity (`"off"` / `"warn"` /
  `"error"`) across the CLI and the `lintDocs()` API (new `rules`, `mounts`,
  and `assumeValidLinkPrefixes` options).
