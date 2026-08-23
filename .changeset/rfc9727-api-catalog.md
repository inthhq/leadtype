---
"leadtype": minor
---

List real API endpoints in the API catalog, per RFC 9727.

The generated `/.well-known/api-catalog` used to describe documentation artifacts: a publisher-root anchor pointing back at itself, plus `service-doc`, `service-desc`, and `describedby`. It contained no link relation that identifies an API, which is the one thing RFC 9727 requires of a catalog. Declare your APIs in site-owned `agents.apis` and the catalog now anchors itself, lists every API with `item`, and anchors each API to carry its own `service-desc`, `service-doc`, `service-meta`, and `status` links, plus media type, title, and optional version. An `href` may be root-relative, document-relative, or absolute, so a catalog can publish cross-origin APIs.

Catalog membership is configured separately from the discovery `Link` header: `agents.apis` names APIs, `AgentDiscoveryLinksConfig` names artifact paths. Pass the manifest to `createAgentDiscoveryHeaders()` / `createAgentDiscoveryLinkHeader()` and the `api-catalog` link is advertised only when a catalog was generated. `service-desc` no longer defaults to `/docs/agent-readability.json` on either surface — that file describes documentation readability, not an API contract, and clients that fetched it as an API description got nothing usable. Point `serviceDescPath` (with the new `serviceDescType`) at a real OpenAPI document instead.

Catalog and discovery URLs reject special-scheme forms that omit their required slashes instead of accepting WHATWG repairs, while valid opaque URIs remain supported and serialize spaces as `%20`. API item and relation `type` attributes must be valid printable-ASCII media types at config load and direct rendering boundaries.

The zero-argument discovery helpers also stop advertising an API catalog by default, because they cannot know whether one was generated. Pass a manifest when available, or set `apiCatalogPath` explicitly to opt in.

`createApiCatalogResponse()` now serves `application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`, adds the self-referential `Link: …; rel="api-catalog"` header RFC 9727 expects on `HEAD`, and returns a bodyless response when `method` is `HEAD`.

Sites with no configured APIs no longer publish a catalog at all. `leadtype generate` and `generateAgentArtifacts()` skip the file and omit `files.apiCatalog` from the manifest, and the runtime adapters 404 the well-known route. Accordingly, `createApiCatalogResponse()` returns `Response | null` and `renderApiCatalog()` throws when no APIs are configured — an empty catalog sends agents looking for APIs that were never declared.
