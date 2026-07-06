This project has `docs/*.mdx` and a `docs.config.ts`. Write a build script at `scripts/build-docs.ts` that uses leadtype's **library APIs** (not the `leadtype` CLI) to produce the agent-facing artifacts for a **hosted docs site**, written under `public/`:

- the converted markdown mirrors (`public/docs/*.md`),
- the routing index `public/llms.txt`,
- the root `public/llms-full.txt` fallback,
- the static search index.

Import `product` and `nav` from the existing `docs.config.ts`. The script should be correct enough to run in order.

A `leadtype` package is already installed. Use whatever resources it provides if helpful.
