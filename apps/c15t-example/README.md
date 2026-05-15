# c15t Example

A real-world consumer of the leadtype pipeline. The c15t docs themselves live in another repo ([`c15t/c15t`](https://github.com/c15t/c15t)) — this app clones them on demand and feeds the docs (`/docs`) and changelog (`/changelog`) collections into leadtype.

## How it's wired

Everything is declared in `leadtype.config.ts`:

```ts
import { defineCollection, defineDocsConfig } from "leadtype";

const c15t = {
  repository: "https://github.com/c15t/c15t",
  ref: "main",
  cacheDir: ".docs-src/c15t",
} as const;

export default defineDocsConfig({
  product: {
    name: "c15t",
    summary: "Developer-first consent management for modern web apps.",
  },
  collections: {
    docs:      defineCollection({ ...c15t, dir: "docs",      prefix: "/docs" }),
    changelog: defineCollection({ ...c15t, dir: "changelog", prefix: "/changelog" }),
  },
});
```

Two collections, one shared clone. `cacheDir` is pinned to `.docs-src/c15t` so the type-table extraction script can find the repo at a stable path.

## Running it

```sh
bun run --filter c15t-example dev
```

On first run, this clones `c15t/c15t` into `apps/c15t-example/.docs-src/c15t` (gitignored). Subsequent runs reuse the cache without touching the network.

To pull the latest c15t main:

```sh
bun run --filter c15t-example docs:generate -- --refresh
```

To prove the cache is sufficient (e.g. in an air-gapped CI lane):

```sh
bun run --filter c15t-example docs:generate -- --offline
```

## What the build does

`bun run docs:generate` runs two steps:

1. `leadtype generate --sync` — syncs `.docs-src/c15t` if missing, then converts MDX, generates `llms.txt`, search artifacts, agent-readability manifest, and markdown mirrors under `public/`.
2. `scripts/generate-type-tables.ts` — extracts TypeScript types referenced by `<AutoTypeTable>` tags into `public/type-tables.json`.

`vite dev` / `vite build` chain `docs:generate` automatically.
