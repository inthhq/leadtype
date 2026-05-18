# leadtype

## 0.2.0

### Minor Changes

- 8b84f60: Add `collections` config and `leadtype sync` for declarative multi-source docs (closes #42, #44).

  - New `defineCollection({ repository?, ref?, cacheDir?, dir, prefix?, schema?, groups?, include?, exclude? })` helper, and `collections?: Record<string, DocsCollection>` on `DocsConfig`. Local-only collections omit `repository`; remote collections clone the repo at `ref` into `cacheDir` (default `.leadtype/sources/<repo-slug>@<ref>`). Multiple collections sharing a `(repository, ref)` pair share one clone.
  - New `leadtype sync` command: `--refresh` re-fetches and fast-forwards, `--offline` errors on cache miss, `--repo <pat>` filters by repository URL substring. State tracked in `<cacheDir>/.leadtype-sync.json`.
  - `leadtype generate` learns `--sync`, `--refresh`, `--offline` (mutually exclusive). Default behavior errors clearly when a remote cache is missing, naming the affected collection(s).
  - New project-level config: `leadtype.config.{ts,js,mjs,cjs}` looked up in cwd before the legacy per-docs-dir `docs.config.*` path. Setting both top-level `groups` and `collections` is rejected at load.
  - `leadtype lint` discovers `leadtype.config.ts` automatically and runs lint per collection, applying each collection's `schema` if set. Violations are prefixed with `[collection:<key>]`.
  - `git`-not-installed surfaces as an actionable message instead of a raw `ENOENT`.

  Legacy projects (single docs folder, top-level `groups` in `docs.config.ts`, `--docs-dir` flags) are unchanged — the legacy code path is byte-identical to before.

  Known limitation: `leadtype sync` has no built-in timeout; a long network stall will hang the process. Track via `Ctrl-C` for now; a configurable per-operation timeout is planned.

- aca9e8f: Add config-driven docs navigation with nested sections, explicit page placement,
  wildcard includes, and root-relative page references.

  `defineDocsConfig()` and `defineCollection()` now accept `nav`, which is used by
  `resolveDocsNavigation()`, `llms.txt`, full-context generation, Agent
  Readability, `AGENTS.md`, source navigation, and CLI generation. Frontmatter
  `group` remains supported as taxonomy, validation metadata, and fallback
  navigation for projects that have not adopted `nav`.

  This also updates the example docs site and c15t example to dogfood root nav
  nodes as top-level docs areas, with the active root node's pages and children
  rendered as sidebar sections.

- e923e9f: Add `leadtype/next` framework adapter and formalize the core/adapter boundary.

  `leadtype/next` exposes three server-only helpers for Next.js App Router: `createGenerateStaticParams(...)`, `createLoadPageData(...)`, and `createDocsRouteHandler(...)`. The route handler wraps `createAgentMarkdownResponse` so a docs app can serve raw markdown, handle `Accept: text/markdown` negotiation, and detect AI user agents from a one-line `route.ts`. The companion `leadtype/next/client` subpath exports a `useLeadtypeSearch` React hook plus a framework-free `createSearchClient` factory that lazy-loads `search-index.json` / `search-content.json` and runs BM25 per keystroke.

  `react` is now an optional peer dependency for `leadtype/next/client`. Server-only consumers never pull in React.

  Documents the core/adapter boundary in a new `docs/reference/architecture` page: leadtype core has zero framework runtime deps, adapters live at flat `leadtype/<framework>` subpaths, and **no leadtype package — core or adapter — ever ships rendered DOM**. State primitives (hooks, composables, stores, handler factories) are allowed; `<SearchBox>`-style components are not. The docs also name the planned native adapter shapes for Nuxt, SvelteKit, Astro, TanStack Start, Vue search, and Svelte search without exporting those APIs yet. The boundary is now enforced by tests in `packages/leadtype/src/internal/package-surface.test.ts` that scan import graphs and fail if framework runtimes leak into core or one adapter imports from another.

### Patch Changes

- c7fcbf6: Add first-class docs i18n support with locale-aware generation, localized source loading, per-locale search/LLM/readability artifacts, and a new `leadtype/i18n` helper surface. Locale-scoped search generation now uses URL-path document ids to align generated indexes with the source API.
- 844a94d: Default `<ExtractedTypeTable>` and `<AutoTypeTable>` path resolution to the Leadtype source root instead of `process.cwd()/docs`.

  This fixes generated docs for source roots such as `.c15t` or `.leadtype`, where `path="./packages/..."` should resolve against the configured source root. Source-MDX consumers can now pass `typeTableBasePath` / `typeTableStrict` through `createDocsSource()` or use `createMdxSourcePlugins()` for bundler-level configuration. Failed type extraction now emits a visible warning by default and can fail generation in strict mode.

  This changes the bare `mdxSourcePlugins` default for bundler consumers: when Leadtype can see the source MDX file path, it derives the base path from the first `docs` path segment instead of always using `process.cwd()/docs`. Projects that intentionally keep referenced TypeScript files under their docs folder should switch to `createMdxSourcePlugins({ typeTableBasePath: path.resolve(process.cwd(), "docs") })`.

## 0.1.2

### Patch Changes

- f7107d3: Ship the v1 headless integration surface plus docs polish.

  **New public API**

  - `createDocsSource({ contentDir })` at the root — framework-neutral docs source primitive returning navigation, page loading, search index, and standalone include resolution. Works with Next App Router, Astro, Vite + Vue/Solid/Svelte, Nuxt, SvelteKit, and any MDX-aware bundler.
  - `leadtype/mdx` subpath — typed prop contracts for every custom MDX tag (`CalloutProps`, `TabsProps`, `StepProps`, `TypeTableProps`, …) plus `mdxSourcePlugins` (a remark preset that expands `<include>` and resolves `<ExtractedTypeTable>` at build time while leaving custom tags as JSX). Framework-neutral — `children` is typed as `unknown` so consumers intersect with React/Vue/Svelte/Solid/Astro child types.
  - `leadtype/fumadocs` subpath — thin adapter mapping `createDocsSource()` to fumadocs-core's `Source` interface, including `meta.json` walking. `fumadocs-core >= 15` is an optional peer dependency.

  **New helpers**

  - `convertMdxFile(path, plugins)` from `leadtype/convert` — returns `{ ast, frontmatter, data, markdown }` in memory for a single MDX file.
  - `resolveInclude(specifier, options)` from `leadtype/mdx` — standalone include resolver, no remark transform required. Plus `parseIncludeSpecifier`, `extractMdxSection`, `resolveIncludePath`.
  - `remarkResolveTypeTableJsx` — source-preset variant of the type-table plugin that emits `<TypeTable properties={…} />` JSX (vs. the existing markdown-flattening variant).

  **Frontmatter contract**

  - New optional `order:` field. Pages with explicit order sort first within their group (ascending); pages without `order` fall back to alphabetical urlPath ordering. Conventionally numbered in tens for insertion room.

  **Navigation**

  - `resolveDocsNavigation` accepts an optional `docsDirName` config field (defaults to `"docs"`) for projects whose docs folder isn't named `docs/`.

  **Bug fixes**

  - Mermaid blocks in agent-flattened markdown no longer destroy `<br/>` line-break syntax (was being replaced with `/` and `-` in two passes). Mermaid renderers now receive valid syntax with multi-line node labels intact.
  - The mermaid plugin's outer-backtick stripper now handles the common `` chart={`flowchart LR\n...`} `` inline form, not just backticks-on-their-own-lines.

## 0.1.1

### Patch Changes

- 92192a7: Fix the CLI direct-run check so package-manager bin shims and symlinked workspace installs correctly run `leadtype generate`.
- 60c285c: Add first-class support for multiple docs source folders and custom URL mounts, including mounted search, LLM, and Agent Readability metadata. The generate command also expands include partials before emitting markdown artifacts, and extracted type tables resolve source paths from the original project root in multi-source builds.
- 1bca5cf: Shrink published install closure by swapping out heavier deps:

  - `gray-matter` → `vfile-matter` + `yaml` (drops `js-yaml`, `kind-of`, `section-matter`, `strip-bom-string` from the closure).
  - `jiti` moved from `dependencies` to optional `peerDependencies` — only required when authoring `docs.config.ts`; `.js`/`.mjs`/`.cjs` configs load via native `import()`.
  - `decode-named-character-reference` dropped — entity decode inside `<Steps>` titles now uses a small inline map.
  - `mdast-util-to-markdown` dropped in `prompt.remark` — serialization now goes through the existing `remark()` processor.
  - `mdast-util-compact` dropped in `steps.remark` — small in-tree adjacent-text/blockquote merge inlined.
  - `unist-builder` dropped — `u(...)` calls replaced with mdast object literals.
  - `unist-util-is` dropped — 7 `is(node, "type")` call sites switched to `node.type === "type"`.

  Behavior change: YAML frontmatter timestamps now round-trip through the `yaml` package's timestamp tag. Date-only scalars like `2026-04-19` emit as `2026-04-19` (compact) instead of `2026-04-19T00:00:00.000Z`. Datetime scalars without sub-second precision emit as `2026-04-19T12:00:00` instead of `2026-04-19T12:00:00.000Z`. The values remain `Date` instances in JS, so consuming code is unaffected.

- 3e03d9d: Replace `fast-glob` with `tinyglobby` to shrink the dependency tree (16 transitive deps → 3) and reduce install footprint (~1.2 MB → ~240 KB). Globbing behavior and call-site options are unchanged.

## 0.1.0

### Minor Changes

- 243f5ff: Release leadtype
