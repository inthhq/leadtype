# Next.js Example

A Next.js App Router consumer of the leadtype pipeline. It dogfoods the
split-repo docs shape by syncing this repo into `.leadtype`, inheriting the
source-owned `docs/docs.config.ts` with `sourceConfig: true`, rendering the
synced MDX pages, serving `.md` mirrors plus `llms.txt` for agents, and
proxying agent-readability headers.

## How it's wired

The app uses two build-time inputs:

- `leadtype.config.ts` declares a remote collection pointed at the monorepo root, cached in `.leadtype`, with `sourceConfig: true`. Set `LEADTYPE_EXAMPLE_SOURCE_REF` to test a branch other than `main`.
- `bun ../../packages/leadtype/dist/cli.js generate --src . --out public --base-url http://localhost:3000 --sync --json` clones missing source cache, inherits source-owned config, and emits `.md` mirrors, `llms.txt`, `llms-full.txt`, search JSON, sitemap/robots files, and `public/docs/agent-readability.json`. The app's `dev` and `build` scripts build the local Leadtype package first so this pre-release CLI is available.
- `scripts/build-mdx-map.mjs` scans `.leadtype/docs` MDX files and writes `app/generated/docs-mdx-map.ts`, which lets the App Router import and render the same synced source MDX at build time.
- `app/docs/[[...slug]]/page.tsx` derives static params from that MDX map, reads navigation and metadata from the generated agent-readability manifest, renders MDX with the same Leadtype component names as the TanStack app, and emits JSON-LD from `leadtype/llm/readability`.
- `proxy.ts` uses `createDocsProxy` from `leadtype/next` for agent/markdown responses, sitemap routes, and robots routes without shadowing normal HTML pages.

## Running it

```sh
bun run --filter next-example dev
bun run --filter next-example build
```

Both scripts build the `leadtype` package and prepare the docs artifacts. Local server scripts use `portless` for HTTPS on :443.

## What the build does

`docs:prepare` runs `docs:generate`, then writes the MDX import map. That keeps the human HTML route and generated agent artifacts pointed at the same synced docs corpus.

## Turbopack dev

The `dev` script runs Next with Turbopack. `next.config.mjs` passes MDX remark plugins as string module specifiers, including `leadtype/mdx/source`, so the loader options stay serializable across Turbopack worker boundaries.

The production build script currently stays on webpack while the production Turbopack build path is debugged separately. The dev dogfood path is Turbopack.

## Relationship to `leadtype init`

To scaffold local-folder wiring into your own app, run `leadtype init --framework next`. This example differs because it intentionally dogfoods the pinned remote collection path that a separate production docs UI app would use.
