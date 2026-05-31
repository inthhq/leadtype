# Fumadocs Example

Shows how leadtype slots underneath a stock Fumadocs UI as an additive layer, not a replacement. It uses the same c15t docs clone as `c15t-example` so you can compare a hand-rolled docs UI against `fumadocs-ui` honestly, with leadtype handling source loading and MDX flattening.

## How it's wired

The c15t docs live in another repo and are cloned into `.docs-src/c15t` (gitignored) by the `setup:source` script — the same clone `c15t-example` uses. `predev`/`prebuild` run it automatically.

`lib/source.ts` backs a Fumadocs `loader` with leadtype:

```ts
import { loader } from "fumadocs-core/source";
import { fumadocsSource } from "leadtype/fumadocs";

const fumadocsSourceResult = await fumadocsSource({ contentDir });

export const source = loader({ baseUrl: "/docs", source: fumadocsSourceResult });
export const leadtypeSource = fumadocsSourceResult.leadtype;
```

- `fumadocsSource()` from `leadtype/fumadocs` walks `.docs-src/c15t/docs`, picks up both `.mdx` pages and c15t's `meta.json` files, and resolves `<include>` / `<ExtractedTypeTable>` at build time via `createMdxSourcePlugins()` (wired in `next.config.mjs`).
- `app/docs/[[...slug]]/page.tsx` renders inside `fumadocs-ui` layouts, calling `leadtypeSource.loadPage(slug)` and `listPages()` directly and rendering `page.markdown` with `MDXRemote`.

## Running it

```sh
bun run --filter fumadocs-example dev
bun run --filter fumadocs-example build
```

`predev`/`prebuild` clone or reuse the c15t source first. `build` also builds the `leadtype` package. Set `C15T_REFRESH=1` to pull the latest c15t main.

## What the build does

There is no `docs:generate` step here — instead of emitting static `.md`/`llms.txt` artifacts, this app consumes the leadtype `DocsSource` directly at request/build time. `setup:source` ensures the c15t clone exists at `.docs-src/c15t`, then `next build` produces the Fumadocs site.

## Relationship to `leadtype init`

`leadtype init` does **not** scaffold this app — the Fumadocs interop (cloning an external source, backing `loader()` with `fumadocsSource()`) is heavier, app-specific setup. Follow the `integrate-with-fumadocs` recipe under `/docs/build` instead.
