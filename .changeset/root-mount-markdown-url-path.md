---
"leadtype": patch
---

Resolve root mount and trailing-slash paths correctly in `toMarkdownUrlPath`. Root mounts with URL path `/` now map to `/index.md` instead of `"/.md"`, and URLs with trailing slashes (e.g. `/docs/`) normalize properly before appending the `.md` or `/index.md` extension.
