---
"leadtype": patch
---

Number table-of-contents anchors across every heading, not just the ones inside `minLevel`/`maxLevel`. A heading filtered out of the TOC still claims its anchor on the rendered page, so with the default 2..3 range a page opening with `# Install` followed by `## Install` emitted a TOC entry pointing at `#install` (the h1) instead of `#install-1`. `leadtype lint` already collected anchors over the full 1..6 range; the TOC now agrees with it.
