---
"leadtype": minor
---

Add `leadtype/next` framework adapter and formalize the core/adapter boundary.

`leadtype/next` exposes three server-only helpers for Next.js App Router: `createGenerateStaticParams(...)`, `createLoadPageData(...)`, and `createDocsRouteHandler(...)`. The route handler wraps `createAgentMarkdownResponse` so a docs app can serve raw markdown, handle `Accept: text/markdown` negotiation, and detect AI user agents from a one-line `route.ts`. The companion `leadtype/next/client` subpath exports a `useLeadtypeSearch` React hook plus a framework-free `createSearchClient` factory that lazy-loads `search-index.json` / `search-content.json` and runs BM25 per keystroke.

`react` is now an optional peer dependency for `leadtype/next/client`. Server-only consumers never pull in React.

Documents the core/adapter boundary in a new `docs/reference/architecture` page: leadtype core has zero framework runtime deps, adapters live at flat `leadtype/<framework>` subpaths, and **no leadtype package — core or adapter — ever ships rendered DOM**. State primitives (hooks, composables, stores, handler factories) are allowed; `<SearchBox>`-style components are not. The docs also name the planned native adapter shapes for Nuxt, SvelteKit, Astro, TanStack Start, Vue search, and Svelte search without exporting those APIs yet. The boundary is now enforced by tests in `packages/leadtype/src/internal/package-surface.test.ts` that scan import graphs and fail if framework runtimes leak into core or one adapter imports from another.
