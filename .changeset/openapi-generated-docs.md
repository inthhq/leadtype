---
"leadtype": minor
---

Add native OpenAPI page generation for API reference docs. OpenAPI 3.x specs generate MDX operation pages with endpoint, auth, parameter, request/response, and code-sample components that render through your docs UI and flatten into agent-readable markdown (llms.txt, search, package docs bundles).

- `createDocsSource()` / `fumadocsSource()` accept `openapi` config directly, read authored docs live from `contentDir`, and overlay generated pages in a temp directory with `cleanup()` support; `stageOpenApiDocs()` keeps full-copy staging for custom pipelines.
- Generated pages include synthesized JSON examples, nested schema property tables (`results[].title`), and cURL/fetch samples with auth headers and real payloads; `x-codeSamples` overrides are honored.
- Operation prose is escaped for MDX safety, and `leadtype/openapi` plus `Api*` renderer prop types are part of the package surface. The dependency-free `leadtype/mdx/openapi` subpath exports `flattenApiSchemaRows()` so custom renderers derive the same nested property rows (`results[].title`) as the built-in markdown flatteners.
