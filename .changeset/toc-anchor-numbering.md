---
"leadtype": patch
---

Number table-of-contents anchors across every heading, not just the ones inside `minLevel`/`maxLevel`. `createDocsHeadingSlugger` is the shared page-wide counter: first-party heading renderers (and the documented custom-MDX snippet) now use it so `source.loadPage().toc` hashes match rendered `id`s. A heading filtered out of the TOC still claims its anchor, so with the default 2..3 range a page opening with `# Install` followed by `## Install` emits `#install-1` for the h2 instead of the h1's `#install`. `leadtype lint` already collected anchors over the full 1..6 range; the TOC now agrees with it.
