---
"leadtype": minor
---

Add `gitSource()` for declaring one git acquisition with its content collections beneath it.

The flat `collections` map makes every collection carry `repository`, `ref`, and `cacheDir` even when several come from the same repository — so a config repeats acquisition three times for one clone, and a reader has to know that matching `(repository, ref)` pairs are deduped. A source group declares the clone once:

```ts
sources: {
  c15t: gitSource({
    repository: "https://github.com/c15t/c15t.git",
    ref: "main",
    inheritConfig: true,
    collections: {
      docs: { dir: "docs", routePrefix: "/docs" },
      changelog: { dir: "changelog", routePrefix: "/changelog", inheritConfig: false },
    },
  }),
}
```

The source owns acquisition and the default inheritance policy; each collection owns its directory, route prefix, navigation, and any inheritance exception. Both forms normalize to the same source graph, and `sources` may be used alongside `collections`.

Collection ids stay global rather than being scoped to their source, because they name staging mounts, error messages, and JSON output — two sources declaring the same id is an error naming both, not an auto-rename. So is declaring one `(repository, ref)` under two source names.

`leadtype sync` now reports each source id with its dependent collections, and warns when a source tracks a mutable ref instead of a pinned commit. `leadtype generate --json` reports the same acquisition graph, using the same ids. `inheritConfig: false` opts a collection out of a source-level inheritance default.
