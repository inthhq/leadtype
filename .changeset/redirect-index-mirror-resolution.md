---
"leadtype": patch
---

Resolve redirects for index routes and their `.md` mirrors in `resolveRedirect`. Requests for `/index.md`, `/docs/index.md`, or `${section}/index.md` (and direct index routes such as `/docs/index`) now match redirects declared for the canonical route paths (`/`, `/docs`, and `${section}`), redirecting stale agent and client requests to the new mirror instead of failing with 404.
