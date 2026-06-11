# Fumadocs Example

Shows how leadtype slots underneath a stock Fumadocs UI as an additive layer, not a replacement. It renders the repo-root Leadtype docs so it can be compared directly against the TanStack, Next, Nuxt, Astro, and SvelteKit examples.

## How it's wired

`lib/source.ts` backs a Fumadocs `loader` with leadtype:

```ts
import { loader } from "fumadocs-core/source";
import { fumadocsSource } from "leadtype/fumadocs";

const fumadocsSourceResult = await fumadocsSource({ contentDir });

export const source = loader({ baseUrl: "/docs", source: fumadocsSourceResult });
export const leadtypeSource = fumadocsSourceResult.leadtype;
```

- `fumadocsSource()` from `leadtype/fumadocs` walks the repo-root `/docs`, uses `docs/docs.config.ts` for navigation, and resolves `<include>` / `<ExtractedTypeTable>` relative to the repo root.
- `app/docs/[[...slug]]/page.tsx` renders inside `fumadocs-ui` layouts, calling `leadtypeSource.loadPage(slug)` and `listPages()` directly and rendering `page.markdown` with `MDXRemote`.
- `docs:generate` emits the same `.md` mirrors, `llms.txt`, `llms-full.txt`, search index, and `agent-readability.json` files that the other examples serve.

## Running it

```sh
bun run --filter fumadocs-example dev
bun run --filter fumadocs-example build
```

Both commands build the `leadtype` package, generate site artifacts from the root docs, and then run Next with webpack.

## What the build does

`docs:generate` runs `leadtype generate --src ../.. --docs-dir docs --out public --base-url http://localhost:3000 --json`. The Fumadocs UI consumes a live `DocsSource`; the generated artifacts provide the agent-facing markdown/search surface.

## Relationship to `leadtype init`

`leadtype init` does **not** scaffold this app yet. Follow the `integrate-with-fumadocs` recipe under `/docs/integrations` for the adapter pattern.
