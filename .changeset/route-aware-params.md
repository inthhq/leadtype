---
"leadtype": minor
---

Derive framework adapter params from routes, not collection-local slugs.

All five static-params helpers — Next `createGenerateStaticParams`, Astro `createGetStaticPaths`, Nuxt `createPrerenderRoutes`, SvelteKit `createEntries`, TanStack Start `createStaticParams` — used to map each page's collection-local `slug`, which is mount-unaware and drops a collection's `routePrefix`. A changelog page at `/changelog/1-0` yielded `['1-0']`, collection indexes yielded duplicate params, and a `mounts` entry rendered pages at URLs the generated sitemap never advertises.

Params are now each page's mount-aware `urlPath` relative to a route base, and the load helpers resolve those params back through the same route space:

- The base defaults to the source's own `routePrefix`, a new property on `DocsSource` (the catch-all mount's `urlPrefix`, `"/docs"` otherwise). For an unmounted single collection the emitted params are byte-identical to before — existing `app/docs/[[...slug]]` catch-alls keep working untouched.
- `project.getSource(key)` sources carry their collection's `routePrefix`, so one catch-all per collection needs no extra wiring in any adapter — including Nuxt, whose `createPrerenderRoutes` previously joined slugs onto `config.basePath ?? "/docs"` and now emits each page's real route.
- A new `basePath` option on every params/load helper names the prefix the catch-all is actually mounted at; `basePath: "/"` serves a whole multi-collection project from one site-root catch-all with route-prefixed params.
- A page whose URL falls outside the base throws with the page, its URL, and both fixes — never a param that silently renders the wrong URL.

`mounts` that move pages within the prefix now round-trip correctly (params match the advertised URL and still load the page). Raw collection-local slugs passed to the load helpers keep resolving unless another page's mounted route claims the same params; in that collision, the route owner wins.
