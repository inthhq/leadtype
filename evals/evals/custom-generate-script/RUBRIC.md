# Rubric: custom build script with correct API ordering

Task: write `scripts/build-docs.ts` that uses leadtype's library APIs (not the CLI) to produce, under `public/`, the markdown mirrors, `llms.txt`, root `llms-full.txt`, and the static search index — using `product`/`nav` from `docs.config.ts`. Grade the produced script.

Ground truth ordering (this is the docs-only point): the full-context, search, and readability generators read the **already-converted markdown from `<outDir>/docs/`**, so **MDX conversion must run first**. The correct sequence is:
1. `convertAllMdx` (from `leadtype/convert`) → writes `public/docs/*.md`.
2. then `generateLlmsTxt` and `generateLLMFullContextFiles` (from `leadtype/llm`), and `generateDocsSearchFiles` (from `leadtype/search/node`) — all reading from `public/docs`.

## REQUIRED — all must be satisfied
- Calls **`convertAllMdx`** (or the documented conversion API) to write markdown into the output docs dir, and does so **before** the index/search generators.
- Calls **`generateLlmsTxt`** and **`generateLLMFullContextFiles`** to produce `llms.txt` and the root `llms-full.txt`.
- Generates the **search index** via the search-node API (e.g. `generateDocsSearchFiles` from `leadtype/search/node`).
- Passes `product` and/or `nav` from `docs.config.ts` into the generators.

## Critical ordering check
- Conversion must precede the full-context / search generators. If the script runs `generateLLMFullContextFiles` or the search generator **before** conversion (so they'd read an empty/absent `public/docs`), mark it **incorrect** even if all the calls are present.

## Incorrect if
- Shells out to the `leadtype` CLI instead of importing the library APIs.
- Invents API names that aren't part of leadtype, or wires the ordering so generators run before conversion.
