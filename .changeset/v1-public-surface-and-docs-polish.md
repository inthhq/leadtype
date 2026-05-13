---
"leadtype": minor
---

Ship the v1 headless integration surface plus docs polish.

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

- Mermaid blocks in agent-flattened markdown no longer destroy `<br/>` line-break syntax (was being replaced with ` / ` and ` - ` in two passes). Mermaid renderers now receive valid syntax with multi-line node labels intact.
- The mermaid plugin's outer-backtick stripper now handles the common `` chart={`flowchart LR\n...`} `` inline form, not just backticks-on-their-own-lines.
