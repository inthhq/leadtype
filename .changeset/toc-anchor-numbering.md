---
"leadtype": patch
---

Number table-of-contents anchors across every heading, not just the ones inside `minLevel`/`maxLevel`. `createDocsHeadingSlugger` is the shared page-wide counter: first-party heading renderers (and a page-scoped `createMdxHeadingComponents()` snippet) now use it so `source.loadPage().toc` hashes match rendered `id`s. Setext headings are counted too, and emitted ids are reserved so `Foo` / `Foo` / `Foo-1` becomes `foo` / `foo-1` / `foo-1-1`. A heading filtered out of the TOC still claims its anchor, so with the default 2..3 range a page opening with `# Install` followed by `## Install` emits `#install-1` for the h2 instead of the h1's `#install`. `leadtype lint` already collected anchors over the full 1..6 range; the TOC now agrees with it.
