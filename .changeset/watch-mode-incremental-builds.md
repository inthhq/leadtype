---
"leadtype": minor
---

Add `--watch` and incremental builds to `leadtype generate`.

`leadtype generate` is now incremental by default: each converted file's inputs — the MDX source, its `<include>` targets, the TypeScript files its type tables extract from, and its git enrichment — are content-hashed into a manifest under `node_modules/.cache/leadtype/`, and unchanged files are skipped on repeat runs. Outputs whose source file was deleted are pruned. `--force` bypasses the cache; the cache also invalidates automatically on leadtype version, docs-config, or flag changes.

`leadtype generate --watch` (or `-w`) runs the pipeline, then watches the docs source directories and config file and re-runs on change (debounced). With the cache, a one-file edit rebuilds one file.

Library API: `convertAllMdx` accepts a new optional `cache` option, and conversion reports every extra file it reads (include targets via the existing `_compiler.addDependency` protocol, now also type-table TypeScript sources — exposed as `TypeTableOptions.onDependency`).
