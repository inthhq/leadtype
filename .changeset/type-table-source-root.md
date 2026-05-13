---
"leadtype": patch
---

Default `<ExtractedTypeTable>` and `<AutoTypeTable>` path resolution to the Leadtype source root instead of `process.cwd()/docs`.

This fixes generated docs for source roots such as `.c15t` or `.leadtype`, where `path="./packages/..."` should resolve against the configured source root. Source-MDX consumers can now pass `typeTableBasePath` / `typeTableStrict` through `createDocsSource()` or use `createMdxSourcePlugins()` for bundler-level configuration. Failed type extraction now emits a visible warning by default and can fail generation in strict mode.

This changes the bare `mdxSourcePlugins` default for bundler consumers: when Leadtype can see the source MDX file path, it derives the base path from the first `docs` path segment instead of always using `process.cwd()/docs`. Projects that intentionally keep referenced TypeScript files under their docs folder should switch to `createMdxSourcePlugins({ typeTableBasePath: path.resolve(process.cwd(), "docs") })`.
