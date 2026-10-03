---
"leadtype": minor
---

Add `createDocsProject()` — the resolved project config as a runtime source.

`createDocsSource()` describes one content directory, so an app restates what its config already says: the content root, navigation, mounts, the frontmatter schema, and for a multi-collection project all of that per collection plus route prefixes and source-owned inheritance. Two descriptions of one project drift, and when they do the rendered site and the generated agent artifacts disagree about what exists.

A project reads the same resolved config the artifact pipeline reads, and returns a superset of `DocsSource`, so every first-party adapter accepts it unchanged:

```ts
const source = await createDocsProject({
  config: docsConfig,
  configPath: "docs/docs.config.ts",
  baseUrl: "https://example.com",
});
```

Multi-collection projects get one merged, route-aware page API — `listPages()` tags each page with its collection, `loadPage()` accepts a collection-local slug or the full route — plus `project.collections`, `project.sources`, and `project.getSource(key)` for custom integrations. Source-owned config inheritance now runs through one shared implementation, so human rendering and generated artifacts cannot resolve it differently.

Remote collections are cache-only: a missing, unverifiable, or wrong-revision cache fails with a diagnostic naming `leadtype sync` rather than cloning inside a request. Route collisions name both collections.

`createDocsSource()` stays fully supported and is what the project is built on. `leadtype init` now scaffolds the project primitive.
