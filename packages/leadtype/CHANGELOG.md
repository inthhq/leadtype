# leadtype

## 0.5.0

### Minor Changes

- 3981fd2: Make `baseUrl` a config field, so the common path stops repeating it.

  A docs audit found `baseUrl` was the one value every snippet had to state twice — `generate --base-url https://…` for the CLI and `createDocsProject({ baseUrl })` for the runtime — because it was not part of the config. It now is: a site-owned, top-level field next to `product`.

  ```ts
  export default defineDocsConfig({
    product: { name: "Acme", tagline: "Acme does one useful thing." },
    baseUrl: "https://acme.dev",
  });
  ```

  With it set, the scaffolded common path carries no knobs at all: `leadtype generate` needs no `--base-url`, and the runtime is `createDocsProject()` with zero arguments. `leadtype init` writes the value once, into `docs/docs.config.ts`, and nowhere else.

  Precedence is explicit-wins: the `--base-url` flag and the `createDocsProject({ baseUrl })` argument override the config field, and a config without the field keeps the deployment-URL env fallbacks exactly as before. One shared validator now covers every authored spelling — the config field, the flag, and the argument: a base URL must be an absolute http(s) URL, optionally with a path prefix, carrying no query, fragment, or embedded credentials, and is normalized (trailing slashes stripped) so URL joins cannot produce `//`. For the flag and the argument this is stricter than before — they used to forward whatever they were given, so a value like `ftp://acme.dev`, `https://acme.dev?`, or an unparseable string flowed straight into every joined URL and corrupted the generated artifacts. Such a value now fails up front instead: `generate` exits 2 and `createDocsProject` throws.

  Because a base URL says where _this_ site publishes, the field is never inherited via `inheritConfig` — a source-owned `docs.config.*` consumed by several sites should leave it unset and let each site supply its own.

  The resolved value is inspectable like every other derived-or-authored value: provenance carries a `baseUrl` entry (`explicit` with the config path, or `default` naming the env fallback chain), `leadtype doctor` reports the resolved URL and its origin, and `generate --explain` reports the fallback when nothing was authored anywhere.

- 4c1b962: Add a canonical config vocabulary and one resolved-config normalizer.

  `defineLeadtypeConfig` names the project/site config in `leadtype.config.ts`, alongside `defineDocsConfig` for a source repo's content-owned `docs.config.ts`. Three collection fields are renamed: `prefix` → `routePrefix`, `sourceConfig` → `inheritConfig`, `schema` → `frontmatterSchema`.

  Every existing config keeps working. Both spellings normalize to one internal `ResolvedDocsConfig` that generate, sync, lint, score, and the runtime source all read, so no subsystem re-derives the project from raw config. The resolved shape adds a deduped source graph — collections sharing a `(repository, ref)` resolve to one acquisition — and per-field provenance recording whether each value was authored, inherited from a source repo, inferred, or defaulted.

  Deprecated fields carry `@deprecated` guidance in the IDE and warn once per config file at load. Setting an old name and its replacement together is an error naming both rather than a silent precedence rule. Nothing is removed before 1.0.

- 5aa8d2b: Derive navigation and the `llms.txt` body when they aren't authored, so a new project reaches useful output from identity alone.

  Navigation is derived from the content tree — root pages at the root, one section per top-level directory titled from its `index` page, ordered `index` first then frontmatter `order` then path, so it never depends on filesystem enumeration order. The `llms.txt` body becomes a "Best Starting Points" block built from that same resolved navigation, which keeps an agent's entry points from drifting from a reader's. Product name and tagline fall back to `package.json`.

  Both `leadtype generate` and `createDocsSource()` derive the same tree, so the rendered sidebar and the generated artifacts agree. Explicit configuration always wins: authoring `navigation`, `groups`, or `llms.sections` turns inference off for that field, and inference never merges with or rewrites an authored value.

  `leadtype generate --explain` reports every derived value, what it was derived from, and the field that takes control of it. Ambiguous derivations — pages with no frontmatter `title`, or more pages than the starting-points block lists — warn with the field to set.

  `leadtype init` now scaffolds identity only.

- 2fda088: Add `createDocsProject()` — the resolved project config as a runtime source.

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

- 43883be: Add `gitSource()` for declaring one git acquisition with its content collections beneath it.

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

  `sparse` limits a checkout to the repository paths you actually need, via a blobless partial clone — pinning a docs directory out of a monorepo no longer downloads the whole repository. Collections sharing an acquisition must agree on the path set, and the set is recorded in the sync manifest so adding a path re-clones rather than reusing an incomplete cache.

  `leadtype sync` now reports each source id with its dependent collections, and warns when a source tracks a mutable ref instead of a pinned commit. `leadtype generate --json` reports the same acquisition graph, using the same ids — a named source keeps its authored name, an anonymous one is identified by `repository#ref`. `inheritConfig: false` opts a collection out of a source-level inheritance default.

- c21b6b9: Add `leadtype doctor` — a read-only explanation of the resolved project.

  The other commands each answer a question about a project by doing something to it. None answered "what _is_ this project, and why?" — which config was discovered, whether it resolved single-source or multi-repo, which values were authored versus inherited versus inferred, which collections share one clone, what routes will exist, and which command fixes what is currently wrong.

  Doctor never clones, refreshes, writes, or generates, so an unsynced remote is a finding naming `leadtype sync` rather than a fetch. Everything it reports comes from the same config loader and resolvers `generate` and `sync` use, so a clean doctor run and a clean generate run cannot disagree.

  Checks cover config discovery and provenance, deprecated aliases, the deduped acquisition graph with pinned-versus-mutable refs and cache freshness, collection directories and include globs, the resolved navigation tree and pages that fall back to the root instead of being placed, expected output artifacts and their staleness, the detected framework adapter, and enabled agent surfaces.

  Human output is concise and every finding names its owning config field and a concrete next command. `--json` carries stable finding ids and provenance so agents can act without parsing prose. Exit `0` when nothing is an error, `1` when a required input is missing or invalid.

- ba6ecdb: Reduce navigation config churn for large and repeated docs trees.

  A curated tree earns its cost while every entry is a decision. It stops earning it when a section is mostly inventory — twenty pages where three must lead and the rest could be alphabetical — because then every new page is added twice, on disk and in the config, and the two drift.

  `navigation.fromDirectory()` (from `leadtype/navigation`) includes a directory without listing it, and the new `pin` option on include entries keeps the pages whose position is a decision at the front:

  ```ts
  {
    title: "Concepts",
    base: "concepts",
    pages: navigation.fromDirectory(".", {
      pin: ["initialization-flow", "consent-models"],
      exclude: "internal-*",
    }),
  }
  ```

  Pinned pages lead in the order given; the rest follow in `sort` order, so adding a page appends it to the tail and never displaces a deliberate choice. Explicit refs and an expansion can share one `pages` array. A pin matching nothing is an error rather than a silent no-op — that is almost always a rename the config missed. Expansion still happens once during navigation resolution, so one resolved tree keeps driving the sidebar, `llms.txt`, `AGENTS.md`, the sitemap, and Agent Readability metadata.

  `leadtype nav` prints the tree your config actually resolves to and reports drift: pages no curated entry places, pages two entries both claim, and pages whose `group:` names a group the config never declares. Human and `--json` output, per collection, read-only — it never writes config, moves content, or changes a public route.

- f20c593: Describe the NLWeb `/ask` endpoint with a generated OpenAPI 3.1 document.

  With `agents.nlweb.enabled`, `leadtype generate` now writes an OpenAPI 3.1 JSON description of the endpoint `createAskHandler()` serves to `/openapi.json`, so a machine client reads the contract instead of inferring it from prose. It models `GET` and `POST` (both the flat and the NLWeb request shapes, with the body optional because a `POST` may carry the query in URL parameters), the `query`/`q`/`query_id`/`streaming` parameters, the `OPTIONS` preflight and its CORS headers, the JSON answer and the `text/event-stream` response on the same `200`, and one failure envelope with `error.code` typed as an enum. `GET` and `POST` declare `400` and `500`, the body-limit `413` belongs only to `POST`, and `405` is published on the path item because it belongs to methods with no operation. SSE event payloads are published as an `x-sse-events` map — OpenAPI 3.1 has no vocabulary for them. Every operation carries a stable `operationId` (`nlwebAskGet`, `nlwebAskPost`, `nlwebAskOptions`), a description, and typed parameters and responses, so it converts to an LLM function definition without guesswork. Content negotiation is represented by the two `200` media types; the reserved `Accept` header is not emitted as a Parameter Object because OpenAPI consumers must ignore it there.

  `agents.nlweb.openapi` configures it: `enabled` turns it off, `url` sets the public URL (default `/openapi.json`), and `output` sets the emitted path. Each defaults from the other, so moving one moves both; explicitly empty values are rejected instead of invoking those defaults. The derived output uses decoded URL pathname segments, never its query or fragment. `url` rejects malformed percent escapes, backslashes, ASCII controls, and userinfo; `output` rejects percent escapes, ASCII controls, and Windows-reserved device-name segments and is validated at config load rather than at build time — it must be a relative `.json` path inside the output root, so an absolute path, a `.` or `..` segment, or a path that would overwrite another generated artifact or sit beneath one is rejected before a build can clobber it. The public generator repeats this validation before writing its schema artifacts. An absolute `agents.nlweb.endpoint` is split into the document's `servers` entry and its `paths` key, so a cross-origin `/ask` is described honestly. NLWeb endpoints that are empty, whitespace-only, surrounded by whitespace, parent-relative, or contain a query string or fragment; MCP endpoints that contain only whitespace (the empty-string default remains valid); protocol-relative endpoints; non-HTTP scheme-like endpoints; absolute endpoints with userinfo; and NLWeb or MCP endpoints with backslashes, ASCII controls, or malformed percent escapes now fail at config load.

  `leadtype generate` records emitted OpenAPI ownership per output root in `<source>/.leadtype/nlweb.json`, outside the public output directory, and removes only that owned document after a successful move or after NLWeb is removed from config. The ownership map is best-effort: an immutable source tree still generates every public artifact, and a checksummed `x-leadtype-generated` extension lets later runs update an unchanged-path contract without writable state. Move or disable cleanup still cannot be tracked until the source state becomes writable. Changing `url` or `output` does not leave a stale contract at the old URL, while an untracked, hand-authored `openapi.json` is never deleted. Ownership remains on an old output until its deletion succeeds, so a failed cleanup is retried instead of forgotten. Moves between ancestor and descendant paths stage the replacement and keep a rollback copy while resolving file/directory conflicts; an unowned sibling is preserved and aborts the move with the old document restored. Cleanup compares filesystem entries when classifying moves, so case-only and case-equivalent ancestor or descendant moves on a case-insensitive filesystem preserve the new document.

  The endpoint now lists itself in the RFC 9727 API catalog, so an NLWeb site publishes a catalog without declaring anything in `agents.apis`. With `--base-url` or a non-local deployment environment URL, the NLWeb endpoint, `service-desc`, OpenAPI server, schema-feed URLs, MCP endpoint and server card, and agent-interface links use one effective base, including its pathname. Without a publishable base, all of those URLs stay relative for request-origin resolution. Turning OpenAPI off leaves the endpoint listed without a dead description link. A site that declares `/ask` itself keeps its own entry; only a missing `service-desc` is filled in. Catalog rendering deduplicates entries after URL resolution and merges unique links within matching relations. `leadtype generate` reports the emitted file as `files.nlwebOpenapi`.

  `leadtype/nlweb` exports `buildAskOpenApiDocument`, `resolveNlwebOpenApiConfig`, `resolveAskEndpointLocation`, `nlwebApiCatalogEntry`, `withNlwebApiCatalogEntry`, and `writeAskOpenApiDocument` for hosts that build or serve the document themselves.

- 4120312: Give the NLWeb `/ask` handler a machine-actionable failure contract.

  Every non-2xx response now returns an NLWeb-shaped envelope with a leadtype-defined `error` extension: a stable `error.code`, a message, and a short `error.resolution`. The bodyless `204` answer to an `OPTIONS` preflight is the only exception, and failures stay JSON even when the request asked for streaming. `405` keeps its `Allow` header and gains the envelope; both carry the JSON content type and CORS headers.

  Codes ship as `NLWEB_ERROR_CODES`: `invalid_json`, `invalid_request`, `request_too_large`, `missing_query`, `method_not_allowed`, `artifacts_unavailable`, and `internal_error`. A non-empty body that fails to parse is now `invalid_json` instead of being silently reported as a missing query, JSON that parses but isn't an `/ask` document — a non-object payload, or a `query`/`query_id` of the wrong type — is `invalid_request`, and a body over 16 KiB returns `413 request_too_large` with a size-specific recovery hint. An empty `POST` body still answers from the URL query.

  `artifacts_unavailable` and `internal_error` responses are generic: the artifacts error no longer puts local directory paths in the HTTP body. A URL `query_id` is echoed on every failure. `POST` failures also accept the body field, so rejected requests can be correlated without making unsupported methods read their bodies.

  Artifact validation now requires a content store, recomputes every stored chunk length from its selected content, and rejects empty or malformed posting lists before search. Corrupt indexes fail as `artifacts_unavailable` instead of returning plausible but misranked or empty answers.

  Search artifact format version 3 persists each transformed chunk's code text alongside its visible content. Runtime validation can therefore recompute every title, heading, body, and code posting count exactly, rejecting missing, forged, or inflated weights. Regenerate version 2 search artifacts with this Leadtype release before deploying `/ask`.

  Core search, browser clients, and MCP artifact loading validate that separately stored index and content artifacts have matching versions, timestamps, and chunk counts. During an in-place v2-to-v3 deployment, a mixed pair falls back to index-only search instead of crashing while the content artifact catches up. Browser clients do not retain that transient mismatch: a later search retries the pair and caches it once both artifacts match.

  Request-body parsing is now strict. A malformed or non-object JSON body, an invalid `query`, or a non-string `query_id` returns `400` even when the URL contains a valid query; previously those bodies could be ignored and answered from URL parameters. Use the optional `onError` callback to send the original server-side error to your logger while keeping HTTP responses sanitized. A promise returned by the callback is awaited before the response is sent.

  `POST` JSON bodies are capped at 16 KiB. Unsupported methods return `405` without consuming their bodies.

  `NlwebAskResponse` is now a discriminated union of `NlwebAskAnswer` and `NlwebAskFailure` (narrow with `"error" in body`), with `NlwebAskError` and `NlwebErrorCode` exported alongside it.

- 8e3c431: Add `resolveProject()` — one function for the whole config pipeline.

  Answering "what is this project?" takes five ordered steps: discover the config, apply source-owned inheritance, normalize to canonical names, derive what wasn't authored, and resolve each collection's content directory through the sync cache. `generate`, `doctor`, `nav`, and `createDocsProject` each assembled those by hand, and `doctor` and `nav` shipped with the _same two_ bugs as a result — both skipped inheritance, and both resolved a remote collection's `dir` against the config directory rather than its checkout.

  They now read one resolved project. It throws only for a malformed config; everything environmental — an unsynced source, a missing directory, unreadable source config — is a diagnostic carrying a stable id, the owning config field, and the command that fixes it. That split is what lets `doctor` report a problem and keep going while `createDocsProject` refuses to hand a renderer a source it cannot read.

  `createDocsProject()` no longer needs a config passed to it: it discovers `leadtype.config.*` or `docs.config.*` the same way the CLI does, so an app with a config file doesn't import it just to hand it back.

  ```ts
  export const source = await createDocsProject({
    baseUrl: "https://example.com",
  });
  ```

  Config loading also moves out of the CLI into `leadtype`'s config module, so the runtime no longer reaches through the generate pipeline to answer which config describes a project.

- 5f29292: List real API endpoints in the API catalog, per RFC 9727.

  The generated `/.well-known/api-catalog` used to describe documentation artifacts: a publisher-root anchor pointing back at itself, plus `service-doc`, `service-desc`, and `describedby`. It contained no link relation that identifies an API, which is the one thing RFC 9727 requires of a catalog. Declare your APIs in site-owned `agents.apis` and the catalog now anchors itself, lists every API with `item`, and anchors each API to carry its own `service-desc`, `service-doc`, `service-meta`, and `status` links, plus media type, title, and optional version. An `href` may be root-relative, document-relative, or absolute, so a catalog can publish cross-origin APIs.

  Catalog membership is configured separately from the discovery `Link` header: `agents.apis` names APIs, `AgentDiscoveryLinksConfig` names artifact paths. Pass the manifest to `createAgentDiscoveryHeaders()` / `createAgentDiscoveryLinkHeader()` and the `api-catalog` link is advertised only when a catalog was generated. `service-desc` no longer defaults to `/docs/agent-readability.json` on either surface — that file describes documentation readability, not an API contract, and clients that fetched it as an API description got nothing usable. Point `serviceDescPath` (with the new `serviceDescType`) at a real OpenAPI document instead.

  Catalog and discovery URLs reject special-scheme forms that omit their required slashes instead of accepting WHATWG repairs, while valid opaque URIs remain supported and serialize spaces as `%20`. API item and relation `type` attributes must be valid printable-ASCII media types at config load and direct rendering boundaries.

  The zero-argument discovery helpers also stop advertising an API catalog by default, because they cannot know whether one was generated. Pass a manifest when available, or set `apiCatalogPath` explicitly to opt in.

  `createApiCatalogResponse()` now serves `application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`, adds the self-referential `Link: …; rel="api-catalog"` header RFC 9727 expects on `HEAD`, and returns a bodyless response when `method` is `HEAD`.

  Sites with no configured APIs no longer publish a catalog at all. `leadtype generate` and `generateAgentArtifacts()` skip the file and omit `files.apiCatalog` from the manifest, and the runtime adapters 404 the well-known route. Accordingly, `createApiCatalogResponse()` returns `Response | null` and `renderApiCatalog()` throws when no APIs are configured — an empty catalog sends agents looking for APIs that were never declared.

- fa2b38c: Derive framework adapter params from routes, not collection-local slugs.

  All five static-params helpers — Next `createGenerateStaticParams`, Astro `createGetStaticPaths`, Nuxt `createPrerenderRoutes`, SvelteKit `createEntries`, TanStack Start `createStaticParams` — used to map each page's collection-local `slug`, which is mount-unaware and drops a collection's `routePrefix`. A changelog page at `/changelog/1-0` yielded `['1-0']`, collection indexes yielded duplicate params, and a `mounts` entry rendered pages at URLs the generated sitemap never advertises.

  Params are now each page's mount-aware `urlPath` relative to a route base, and the load helpers resolve those params back through the same route space:

  - The base defaults to the source's own `routePrefix`, a new property on `DocsSource` (the catch-all mount's `urlPrefix`, `"/docs"` otherwise). For an unmounted single collection the emitted params are byte-identical to before — existing `app/docs/[[...slug]]` catch-alls keep working untouched.
  - `project.getSource(key)` sources carry their collection's `routePrefix`, so one catch-all per collection needs no extra wiring in any adapter — including Nuxt, whose `createPrerenderRoutes` previously joined slugs onto `config.basePath ?? "/docs"` and now emits each page's real route.
  - A new `basePath` option on every params/load helper names the prefix the catch-all is actually mounted at; `basePath: "/"` serves a whole multi-collection project from one site-root catch-all with route-prefixed params.
  - A page whose URL falls outside the base throws with the page, its URL, and the available fixes — never a param that silently renders the wrong URL.

  `mounts` that move pages within the prefix now round-trip correctly (params match the advertised URL and still load the page). Raw collection-local slugs passed to the load helpers keep resolving unless another page's mounted route claims the same params; in that collision, the route owner wins.

- 2c5a3c6: Tell a broken markdown mirror apart from a page that never existed.

  `createAgentMarkdownResponse()` answered both with the same 200 "Page not found" body. That is right for one of them and wrong for the other. When the manifest lists a page, generation recorded that the page and its mirror exist — so a `readMarkdownFile` that comes back empty means a stale build output, a half-deployed asset host, or an adapter whose fetch failed. Reporting that as a missing page tells an agent a live URL is dead, and invites a CDN to cache the claim.

  That case now answers `500` with `Cache-Control: no-store` and a body that says what actually happened, keeping the markdown `Content-Type`, canonical `Link`, and `llms-txt` discovery headers so the response stays readable, and sending no body for `HEAD`. The new `renderUnreadableMarkdown()` renders it. Adapters inherit this: a Next proxy whose markdown fetch fails for a manifest page now reports a server error instead of a soft miss. The core and framework handler configs also accept `onReadError(target, cause?)` for reporting rejected, empty, or invalid manifest-target reads without changing the stable response. Invalid manifest targets omit `target.filePath` and include the validation error as `cause`.

  Routes with no page behind them — an explicit unknown `.md` path, or an agent-shaped request for a URL the manifest never listed — return 200 with the recovery body by default. Explicit `.md` paths enter recovery even without a Markdown `Accept` header or agent user-agent, so mount site-wide middleware after static routes or scope it when the host owns other `.md` routes. Leadtype's generated Agent Skills and agent-card paths are excluded and keep falling through to the static host. The new `missingStatus` option takes `200` (default) or `404` for sites where dead-link detection, crawl budgets, or monitoring matter more; the recovery body, canonical URL, and discovery links are identical at either status. Every framework adapter accepts it in its handler config.

  `missingStatus` never touches the other outcomes: an existing page still returns 200, a renamed page 308, a removed page 410, and an unreadable mirror 500.

  Manifest pages now also carry `markdownFilePath`, recording where the generator wrote each markdown mirror relative to the output directory. `resolveManifestMarkdownMirrorTarget()` returns it as `MarkdownMirrorTarget.filePath`, so both the docs-tree and bring-your-own-pages generators resolve their actual layouts. Older manifests keep using the previous `docs/<relativePath>.md` fallback.

  For older bring-your-own-pages manifests, runtime readers retry the legacy root-relative mirror when the guessed `docs/` path is missing or throws. The retry is accepted only when its generator-owned `canonical_url` and `last_updated` frontmatter match the manifest page, preventing a stale root file from being served for an old mounted docs-tree manifest. A successful retry suppresses the guessed-path error; if both attempts fail, reporting preserves the original failure context.

  The default-locale manifest may point at separately generated locale manifests without listing their pages itself. Pass those preloaded manifests through `localizedManifests`, keyed by locale code, to serve their pages. Cross-locale reads now require an exact page entry from the matching version-1 manifest and use its recorded `markdownFilePath`, including `index.md` storage. Missing or mismatched locale manifests and unlisted pages fail closed without probing a guessed path, so stale files left on disk are never served.

  Generated filesystem paths may contain literal percent signs. Next proxy requests encode each path segment at the URL boundary, while encoded traversal and separator attempts remain rejected during manifest resolution.

### Patch Changes

- d725444: Route `leadtype generate` and `leadtype lint` through the same resolved project as doctor and the runtime.

  Generate used to assemble a project of its own after sync, and lint read collections without running source-owned inheritance — so a remote collection with `inheritConfig: true` was checked against the defaults, and a stale checkout's `docs.config` could still be imported before the cache was verified. Both commands now call `resolveProjectFromLoaded`. Inheritance is applied; a missing or wrong-revision cache is a diagnostic naming `leadtype sync` rather than a silently empty lint or a module that should never have run.

- bdc62b3: Keep repeated search-result heading anchors aligned with the table of contents and rendered page. Search indexing now uses the same page-scoped heading allocator and recognizes the same ATX, Setext, and fenced-code boundaries, including headings that do not produce a search chunk.
- b392b12: Anchor search result excerpts on the match in the original text. `buildExcerpt` located the query inside the NFKD-normalized text and then sliced the raw text with that offset, but NFKD is not length-preserving (`…` → `...`, `½` → `1⁄2`, `ﬁ` → `fi`, CJK compatibility forms), so the excerpt window drifted past the match — far enough on some chunks that the excerpt came back as just `...`.
- a9ba44c: Keep table-of-contents and search anchors aligned with rendered Setext and ATX headings containing inline HTML or MDX markup, including indentation and line-ending edge cases.
- d517dc5: Make the generated docs-skill and the `leadtype init` AGENTS.md pointer describe documentation authoring, not just retrieval. A skill's description is the whole activation signal a client sees before loading it, so "read and search the docs" lost the most common docs task there is — writing, editing, reviewing, and restructuring the pages themselves.
- f9d2185: Hash `paths.lock.json` entries from authored source, not generated markdown.

  The lockfile exists to remember published paths so a later generate can detect renames. Fingerprinting the generated `.md` mirror folded ExtractedTypeTable rows, expanded includes, and converter formatting into every hash — so working on unrelated types, running generate in `--watch`, or even regenerating with a slightly different pipeline rewrote a committed lockfile. Hashes now come from the source `.mdx`/`.md` body when one exists (frontmatter still excluded). Pages with no authored source, such as generated OpenAPI reference pages, still hash the mirror. `redirectFrom` is still read from the generated mirror, so `afterFrontmatter` transformers that add it keep working.

  The next generate after upgrading rewrites hashes once. Old and new hashes cannot match, so a rename in that same generate will fail as an unmatched disappearance instead of auto-redirecting. Upgrade and rename in two separate generates (two commits). After the first rewrite, authored pages only change the lockfile when their source body or the path set changes.

- 99fb9a4: Make `leadtype sync` consume the resolved source graph instead of rebuilding one.

  `resolveSources` (what doctor and `generate --json` report) and `resolveRemoteSources` (what sync cloned from) used the same `(repository, ref)` key with different rules, so a config could look coherent in doctor and then fail at clone time — or worse, look coherent and sync the wrong checkout. Three of those gaps were real: collections that disagreed on `sparse` merged silently, a mix of explicit and default `cacheDir` resolved one way in normalize and the other in sync, and a git source named `local` collided with the implicit local source.

  Those checks now live in `resolveSources`. A shared acquisition must agree on its sparse set and its cache directory (compared as resolved paths, so spelling out the default location is still valid). Duplicate source ids are rejected at config load. `syncSources` projects that graph; it no longer decides identity. Configs that already synced keep the same clone layout, manifests, and output. Configs that could not sync now fail when the config loads, with the same specifics, instead of only when `leadtype sync` runs.

- f3891e8: Number table-of-contents anchors across every heading, not just the ones inside `minLevel`/`maxLevel`. `createDocsHeadingSlugger` is the shared page-wide counter: first-party heading renderers (and a page-scoped `createMdxHeadingComponents()` snippet) now use it so `source.loadPage().toc` hashes match rendered `id`s. Setext headings are counted too, and emitted ids are reserved so `Foo` / `Foo` / `Foo-1` becomes `foo` / `foo-1` / `foo-1-1`. A heading filtered out of the TOC still claims its anchor, so with the default 2..3 range a page opening with `# Install` followed by `## Install` emits `#install-1` for the h2 instead of the h1's `#install`. `leadtype lint` already collected anchors over the full 1..6 range; the TOC now agrees with it.

## 0.4.3

### Patch Changes

- 7f4d1ae: Fix Windows builds and cross-platform output determinism.

  - Rollup build: classify module ids as external with `path.isAbsolute` so resolved ids (e.g. `D:/…/src/i18n/index.ts`) are treated as internal on Windows, fixing `"../i18n" is imported as an external by "src/feed/index.ts"` build failures.
  - Normalize CRLF line endings at content read sites so emitted `.md` mirrors and content hashes are byte-identical across platforms: `convert.ts` MDX source reads, `include.remark.ts` `<include>` partial reads, and `llm/skills.ts` skill body resolution (affects `SKILL.md` `integrity`/`digest` for bodies containing `\r\n`).

- 06df731: Resolve default type-table base paths with POSIX separators on Windows so type-table path resolution behaves identically across platforms.
- a305cde: Retry atomic artifact renames on Windows sharing violations (`EPERM`/`EACCES`/`EBUSY`) with short backoff, so `writeFileAtomic`/`copyFileAtomic` — and therefore `leadtype generate` — no longer fail when a concurrent reader (parallel build step, editor, antivirus scan) briefly holds an output file open.

## 0.4.2

### Patch Changes

- 68f12d0: Fix snippet typechecking on Windows by normalizing virtual file paths before TypeScript compiler host lookups.
- 646ae9f: Fix `convertAllMdx()` directory pruning on Windows by normalizing globbed paths before comparing them with the output directory.

## 0.4.1

### Patch Changes

- fd79078: Use named OpenAPI request body examples in generated code samples and avoid repeating them as standalone request examples before the snippets.

## 0.4.0

### Minor Changes

- 40a0215: Batch Git frontmatter enrichment during `convertAllMdx` (closes #108).

  When `enrichFrontmatterFromGit` is enabled, batch conversion now reads Git history once for the docs tree and maps results back to each converted file instead of spawning `git log` per file. A 120-file synthetic docs benchmark measured the Git metadata read dropping from ~2.36s of per-file process spawning to ~12ms for the batched read; end-to-end conversion added ~27ms over no enrichment.

  The enrichment remains best-effort for shallow clones, missing Git, and untracked files. `lastModified` still comes from the latest file commit, while `lastAuthor` now falls back to the latest non-bot author when the newest commit was authored by automation.

- 40a0215: Add generated API catalog and homepage discovery Link helpers for agent-readable sites.

  `generate` and `generateAgentArtifacts()` now emit `/.well-known/api-catalog` alongside robots and sitemap artifacts, route handlers can serve it dynamically, and `leadtype/llm/readability` exports helpers for RFC 8288 `Link` headers that advertise the catalog, service docs, service description, and sitemap. Robots output also includes scanner-friendly AI crawler aliases and renders Content-Signals in `ai-train, search, ai-input` order.

- 40a0215: Use Satteri and the native markdown pipeline for agent-facing markdown conversion.

  `convertAllMdx`, `convertMdxFile`, `convertMdxToMarkdown`, and `leadtype generate` now parse MDX through Satteri and run native markdown transforms/stringification for agent-facing output.

  The legacy agent-side Remark conversion path has been removed. This removes `markdownEngine`, the `leadtype/remark` compatibility export, and legacy aliases such as `defaultRemarkPlugins`, `legacyDefaultMarkdownTransforms`, and `builtinFlattenerPlugins`. Source-MDX bundler APIs under `leadtype/mdx` and `leadtype/mdx/source` remain intact.

- 40a0215: Add an opt-in `prune` option to `convertAllMdx` that removes orphaned `.md`
  outputs when a source page is deleted or renamed.

  Previously a renamed page left its old `.md` behind in `outDir` — a live URL
  with stale content that leaked into sitemaps, link checks, and search
  indexing — and every consumer had to hand-roll the same garbage-collection
  step. With `prune: true`, `convertAllMdx` deletes any `.md` under `outDir`
  that the current source set did not produce, then removes directories the
  deletions emptied.

  Guardrails:

  - Only `.md` files are candidates; other files sharing `outDir` are never
    touched, and symlinks are never followed.
  - Pruning is skipped (with a warning) when any page fails to convert or when
    `srcDir` resolves to zero pages, so a partial or misconfigured run never
    mass-deletes output.
  - `pruneKeep` globs (relative to `outDir`) exempt `.md` files written by
    other tools, e.g. `pruneKeep: ["sitemap.md", "mirrors/**"]`. Nothing is
    exempted implicitly.
  - While pruning, the run holds the same per-`outDir` lock as
    `leadtype generate` (reentrant when generate itself is the caller;
    `LEADTYPE_NO_LOCK=1` opts out), so a prune cannot delete output a
    concurrent run just wrote.

- 40a0215: Add a `generatedAt` option to the agent artifact generators so manifests and
  timestamp fallbacks can be reproduced byte-for-byte across deterministic builds.
- 40a0215: Make `leadtype lint` config-aware, so a bare `leadtype lint` validates the
  same source tree — with the same routing rules — that `generate` builds.

  - **Config discovery**: with no `--src`, lint finds `leadtype.config.*` at
    the project root or `docs.config.*` in `./docs` / `./content`, exactly like
    generate, and lints that tree. Flags still override everything. A config
    that fails to load reports a lint failure instead of crashing.
  - **Mount-aware link checking**: routes are derived with the config's
    `mounts` applied, and links under every mount prefix (e.g. `/changelog/v1`)
    are validated like `/docs/...` links — including catching stale `/docs/...`
    paths to pages that moved under a mount. Links under generated trees (the
    OpenAPI `output` prefix) are assumed valid, since those routes only exist
    after `leadtype generate`.
  - **The config's own links are linted** (new `config-link` rule): curated
    `navigation` entries matching no page and `llms.sections` links to missing
    routes are errors; feed `source.urlPrefix` values matching no pages and
    `redirects.removed` paths that are live again are warnings. Previously
    these bypassed lint and only surfaced when generate blew up.
  - **New `lint` block in the docs config**: `lint.ignore` replaces the default
    ignore globs, `lint.unknownFieldSeverity` sets the unknown-field default,
    and `lint.rules` remaps any rule's severity (`"off"` / `"warn"` /
    `"error"`) across the CLI and the `lintDocs()` API (new `rules`, `mounts`,
    and `assumeValidLinkPrefixes` options).

- 7f91c26: Add the opt-in `external-link` lint rule — the scheduled-CI half of the
  dead-link story (internal links are checked deterministically in PR CI;
  external URLs need the network, so they run on a schedule instead of in the
  merge gate).

  - Enable with `leadtype lint --external-links` (scheduled workflows) or a
    `lint.rules["external-link"]` severity in the docs config; a
    copy-pasteable weekly GitHub Actions recipe ships in the validate-in-ci
    docs.
  - Robust by default: HEAD with GET fallback for servers that reject HEAD,
    one retry on network hiccups, rate-limiting (429) treated as skip rather
    than failure, per-URL dedupe across pages, and bounded concurrency.
  - Confirmed-live URLs are cached under `node_modules/.cache/leadtype/`
    (default 7 days, `lint.externalLinks.ttlHours`); failures are never
    cached, so a site that comes back is noticed on the next run.
    `lint.externalLinks.ignore` mutes known-flaky URL prefixes.
  - Violations carry the page file and line like every other rule.

- 40a0215: Expand `leadtype lint`'s internal link coverage (closes the gaps tracked in
  #86):

  - **Relative links** (`./sibling`, `../guides/x`, extension optional) resolve
    against their source file and validate like absolute links; links that
    climb out of the docs tree are errors.
  - **Anchor validation** (new `invalid-anchor` rule): same-page `#fragment`
    links and fragments on cross-page docs links must match a heading anchor on
    the target page. Anchors are extracted from the rendered markdown with the
    same slugger and duplicate handling that builds the site TOC — includes
    expanded — so lint and the rendered site cannot disagree. (Running this on
    leadtype's own docs immediately found three anchors that had been silently
    broken on the live site.)
  - **Redirect-aware messages**: with redirect tracking enabled, an
    `invalid-link` whose target matches a lockfile redirect reports
    "moved to `<new path>` — update the link" instead of a bare missing-route
    error.
  - Link-check scope and non-goals are documented in the lint reference.

- 40a0215: Add parse-level code snippet linting (`snippet:parse`, the first tier of
  #93): every fenced code block with a known language must parse — TS/TSX/JS
  via the TypeScript parser (skipped when the optional `typescript` peer
  dependency isn't installed), JSON and YAML via real parsers.

  Docs snippets are deliberately fragmentary, so the checker is
  fragment-tolerant before it reports: bare API signatures, `key: value`
  config excerpts, object- and type-shape blocks, sibling JSX examples, and
  `...` ellipsis lines all parse without annotation, as do JSON comments,
  trailing commas, and multi-document YAML. Anything else can be marked
  deliberate with a twoslash-style `// @noErrors` line — the same directive
  the upcoming typecheck tier honors.

  Tuned on leadtype's own 51-page docs corpus: zero annotations needed, and
  the only findings were real bugs (a JSX component in a `ts` fence and
  config excerpts that couldn't parse standalone).

- 40a0215: Add opt-in TypeScript snippet typechecking (`snippet:types`) — the flagship
  tier of code-snippet linting: with `lint: { snippets: { typecheck: true } }`
  in the docs config, module-shaped `ts`/`tsx` snippets are assembled into
  virtual modules and typechecked against your project's `tsconfig.json` and
  real `node_modules`. When a package API changes, every doc example still
  calling the old API fails lint — docs that can't rot.

  - Twoslash conventions: `// @filename: name.ts` builds multi-file examples
    (parts can import each other), `// @check` opts a fragment in,
    `// @noErrors` opts anything out, and `// ---cut---` hides setup lines
    from rendered output while they still typecheck. A new default markdown
    transform strips all directives from generated mirrors and converted
    output, so the authoring convention never reaches readers.
  - Scope is deliberately practical: only snippets containing `import`/`export`
    are checked by default (the copy-pasteable ones), imports of packages your
    project doesn't install degrade to `any` instead of failing, and JSX
    environment gaps (no React installed) are tolerated — strictness applies
    to everything that resolves, most importantly the documented package
    itself.
  - All snippets check in one shared compiler program, so cost stays flat
    regardless of snippet count.

- 331a912: Add a `ChildrenTypeRegistry` augmentation hook to `leadtype/mdx`, so
  framework consumers type `children` once per project instead of casting in
  every component. Leadtype still ships zero renderer dependencies — the
  registry is empty by default and `children` stays `unknown` (no behavior
  change without opting in):

  ```ts
  // types.d.ts
  declare module "leadtype/mdx" {
    interface ChildrenTypeRegistry {
      type: import("react").ReactNode;
    }
  }
  export {}; // module marker: augments the package instead of replacing it
  ```

  After that single declaration, every tag prop type (`CalloutProps`,
  `TabsProps`, `StepProps`, …) exposes correctly typed `children` — verified
  through the published type rollup, and adopted by the React examples in the
  docs. The resolved type is also exported as `TagChildren`.

- 40a0215: Add native OpenAPI page generation for API reference docs. OpenAPI 3.x specs generate MDX operation pages with endpoint, auth, parameter, request/response, and code-sample components that render through your docs UI and flatten into agent-readable markdown (llms.txt, search, package docs bundles).

  - `createDocsSource()` / `fumadocsSource()` accept `openapi` config directly, read authored docs live from `contentDir`, and overlay generated pages in a temp directory with `cleanup()` support; `stageOpenApiDocs()` keeps full-copy staging for custom pipelines.
  - Generated pages include synthesized JSON examples, nested schema property tables (`results[].title`), and cURL/fetch samples with auth headers and real payloads; `x-codeSamples` overrides are honored.
  - Operation prose is escaped for MDX safety, and `leadtype/openapi` plus `Api*` renderer prop types are part of the package surface. The dependency-free `leadtype/mdx/openapi` subpath exports `flattenApiSchemaRows()` so custom renderers derive the same nested property rows (`results[].title`) as the built-in markdown flatteners.
  - OpenAPI-only docs configs are valid, remote specs and remote `$ref` targets time out after 30 seconds, and generated OpenAPI pages now fail loudly instead of overwriting pre-existing docs files.

- 40a0215: Add opt-in redirect tracking for renamed and deleted docs pages, so old URLs
  stop 404ing in search engines and agent indexes.

  Enable it with a `redirects` block in `docs.config.ts`. `leadtype generate`
  then maintains a committed lockfile (`paths.lock.json` next to the docs
  sources) recording every published path with a content hash, and emits
  `<out>/docs/redirects.json`:

  - **Pure moves are detected automatically** — a path that disappears while
    its content hash reappears at a new path gets a permanent 308 redirect
    with zero authoring. Hashes exclude frontmatter, so git-enrichment churn
    doesn't defeat the match, and ambiguous matches are never guessed.
  - **Unexplained disappearances fail the build loudly**, listing each path
    with the fix: add `redirectFrom: [<old path>]` frontmatter to the
    successor page, or acknowledge intentional deletions under
    `redirects.removed` to serve 410 Gone.
  - **Redirects accumulate and self-maintain**: chains from successive renames
    collapse to the final target, entries whose target is later removed
    degrade to 410, and entries whose path comes back alive are dropped.
  - New edge-safe `leadtype/redirects` entry point exports `resolveRedirect`
    and the pure computation primitives for serving redirects in any
    framework's catch-all (no Node built-ins, so it links in Cloudflare
    Workers / Vercel Edge); generate-time lockfile IO lives under
    `leadtype/redirects/node`. `createAgentMarkdownResponse` accepts the
    entries directly and answers agent-shaped requests for renamed pages —
    including `.md` mirrors, with index-route targets resolved to their real
    `index.md` mirror path — with the 308/410, while browser requests fall
    through to the host app's routing.
  - Enabling `redirects` also enables conversion pruning, since rename
    detection requires stale mirrors of renamed sources to be
    garbage-collected from the output set.
  - Filtered generates (`--include` / `--exclude`) skip redirect tracking and
    pruning with a warning — a partial page set would make every excluded page
    look deleted.
  - `redirectFrom` is now part of the default frontmatter lint schema.

- 40a0215: Add `--watch` and incremental builds to `leadtype generate`.

  `leadtype generate` is now incremental by default: each converted file's inputs — the MDX source, its `<include>` targets, the TypeScript files its type tables extract from, and its git enrichment — are content-hashed into a manifest under `node_modules/.cache/leadtype/`, and unchanged files are skipped on repeat runs. Outputs whose source file was deleted are pruned. `--force` bypasses the cache; the cache also invalidates automatically on leadtype version, docs-config, or flag changes.

  `leadtype generate --watch` (or `-w`) runs the pipeline, then watches the docs source directories and config file and re-runs on change (debounced). With the cache, a one-file edit rebuilds one file.

  Library API: `convertAllMdx` accepts a new optional `cache` option, and conversion reports every extra file it reads (include targets via the existing `_compiler.addDependency` protocol, now also type-table TypeScript sources — exposed as `TypeTableOptions.onDependency`).

### Patch Changes

- 40a0215: Cache repeated `<include>` / `<import>` resolution within a conversion run.

  `remarkInclude` now accepts an optional include-resolution cache and
  `convertAllMdx()` creates one cache per batch run, so pages that reuse the same
  partial share the raw file read and parsed markdown AST. Cache keys are scoped
  to absolute resolved paths and parser identity, while section anchors such as
  `file.mdx#setup` still extract independently from cloned ASTs.

  The new `createIncludeResolutionCache()` helper exposes lightweight cache stats
  for instrumentation. Current docs and c15t fixtures do not contain repeated
  real include nodes, but a synthetic 200-page repeated-include benchmark showed
  one raw read, one markdown parse, and roughly a 5.9x speedup in include
  expansion time.

- 40a0215: Make generation safe to invoke concurrently against a shared `outDir`.

  Parallel task graphs (lint, typecheck, and build each depending on "docs are
  generated") used to race on the shared output directory, causing intermittent
  partial reads, ENOENT on files another run had just replaced, and half-written
  artifacts.

  - Every generated artifact (converted `docs/*.md`, `llms.txt`, `llms-full.txt`,
    search index, sitemaps, robots, feeds, MCP card, NLWeb, skills, sync
    manifests) is now written to a temp sibling and atomically renamed into
    place, so concurrent readers see the old content or the new content — never
    a truncated file.
  - Delete-then-recreate windows are gone: the agent-skills surface and mounted
    markdown mirrors now write the new files first and prune stale ones after,
    instead of `rm -rf`-ing a live directory before rebuilding it.
  - `leadtype generate` runs are single-flight per output directory via a
    cross-process lock stored under the system temp dir (keyed by the resolved
    `--out` path). Concurrent invocations wait for the in-flight run. Abandoned
    locks recover fast: interrupted runs (SIGINT/SIGTERM) release on the way
    out, hard-killed runs are reclaimed as soon as their recorded pid is gone,
    and unidentifiable locks are reclaimed after 10 minutes. Waiting runs fail
    loudly after 15 minutes instead of hanging CI (`LEADTYPE_LOCK_TIMEOUT_MS`
    overrides). Set `LEADTYPE_NO_LOCK=1` to opt out. Temp files leaked by a
    hard-killed run are swept at the start of the next locked run.

- 40a0215: Sort `manifest.pages` from `generateAgentReadabilityArtifacts` in navigation
  order instead of alphabetical `urlPath` order.

  Navigation order (groups depth-first, then pages within each group) is the
  authored reading order, which is what agent/LLM consumers of the manifest want.
  Pages not present in the navigation are appended sorted by `urlPath`, so the
  output stays fully deterministic. `sitemap.xml` is rendered from the same list
  and now shares the navigation order; `sitemap.md` already followed it.

  `generateLLMFullContextFiles` now applies the same ordering in legacy `groups`
  mode (it previously only reordered under curated `nav`), so `llms-full.txt`
  stays in sync with the manifest in both modes. The bring-your-own-pages
  `generateAgentArtifacts` entry point is unchanged — there the input `pages`
  order is the authored order.

  Fixes #115.

- 79d8fcc: Polish the docs MCP surface for MCP clients and agent-readiness scanners.

  - The generated server card now carries `serverInfo.instructions` — defaulting
    to a summary-derived "Search and read the documentation for …", overridable
    via `agents.mcp.serverInfo.instructions` — and the live server advertises the
    same instructions in its `initialize` response.
  - Tool summaries on the card carry `readOnlyHint`/`idempotentHint` annotations,
    and `agents.mcp.icon` (or its `logo` alias) sets a card icon for registries
    and scanners.
  - Generate additionally writes the card to a root `/mcp.json`, alongside the
    existing card path and the `/.well-known/mcp.json` discovery copy.
  - Invalid tool calls surface structured JSON-RPC errors with proper error codes
    instead of generic internal errors.

## 0.3.1

### Patch Changes

- 5fc0f1a: Fix the docs MCP server 500ing in serverless production deployments. `leadtype/mcp` previously loaded `@modelcontextprotocol/sdk` through a variable-specifier dynamic import, which bundlers and serverless file tracing (Vercel/NFT) cannot see — so deployments that resolved the SDK locally shipped functions without it and every `/mcp` request failed with "the optional peer dependency @modelcontextprotocol/sdk is not installed". The SDK is now imported statically by `mcp/server`, `mcp/http`, and `mcp/stdio`, so tracing includes it automatically. Importing `leadtype/mcp` therefore requires the SDK to be installed (it was already required to serve requests); the CLI still runs every non-serving command — including `leadtype mcp --check` — without it by loading the server lazily.
- 5fc0f1a: Recognize current retrieval AI agents in robots.txt policies and `isAgentUserAgent`: Claude-SearchBot, Claude-User, Perplexity-User, Gemini-Deep-Research, DeepSeekBot, and Meta-ExternalFetcher join the retrieval crawler list, so `block-training` policies keep them allowed and `block-ai` policies actually cover them instead of letting them fall through to the `User-agent: *` group.
- 5fc0f1a: Add NLWeb support under a new `leadtype/nlweb` entry. `createAskHandler()` mounts a Web-standard NLWeb `/ask` endpoint over the generated docs artifacts — list-mode answers backed by the same search index the docs MCP server uses, returning `{ query_id, _meta, results }` documents (each result carries `url`/`name`/`site`/`score`/`description`/`schema_object`) or SSE `start`/`result`/`complete` events when streaming is requested via `prefer.streaming`, `?streaming=`, or an `Accept: text/event-stream` header. Setting `agents.nlweb.enabled` in the docs config makes `leadtype generate` emit a schema.org JSONL feed at `/feeds/schema.jsonl`, a `/schema-map.xml` listing it, and a `Schemamap:` directive in robots.txt (also available directly via `renderRobotsTxt`/`createRobotsTxtResponse`'s new `schemamapUrlPath`).
- 5fc0f1a: Richer MCP discovery surface. The generated server card now carries top-level `name`, `description`, `serverUrl`, and `tools[]` (static summaries of the enabled docs tools, configurable via `agents.mcp.tools`) alongside the existing `serverInfo`/`transport` fields, matching what agent-readiness scanners read. `generate` additionally writes a discovery copy of the card to `/.well-known/mcp.json`, and the root `llms.txt` gains an `## Agent Interfaces` section linking the MCP endpoint, its server card, and the NLWeb `/ask` endpoint when those surfaces are enabled.

## 0.3.0

### Minor Changes

- b141edd: Add browser-side WebMCP docs tools, framework lifecycle helpers, and CLI scaffolding.
- 9bf1f94: Add `generateAgentArtifacts()` to `leadtype/llm` — a bring-your-own-pages entry point that emits the full agent artifact set (llms.txt plus the `.well-known` copy, per-page Markdown mirrors at `${urlPath}.md` with `canonical_url`/`last_updated` frontmatter, sitemap.xml/sitemap.md, robots.txt with Content-Signals, and a root-level agent-readability manifest) from an in-memory page list instead of an `.mdx` docs tree, so CMS-backed blogs, marketing sites, and data-driven pages can publish agent artifacts without the docs pipeline. `emitRootCrawlerFiles: false` supports microfrontend fragments whose host app owns the origin-level crawler files. Root URL mounts (`urlPrefix: "/"`) now resolve correctly instead of emitting `//page` paths.
- 873c833: Move generate capability toggles toward config-driven defaults. `leadtype generate` now enriches markdown with Git-derived `lastModified` and `lastAuthor` by default, skipping safely when git metadata is unavailable. Bundle-mode MCP artifacts are inferred from `agents.mcp.enabled`, while the legacy `--mcp`, `--enrich-git`, and `init --webmcp` shortcut flags remain supported with deprecation warnings.
- a223c49: Add config-driven RSS and Atom feed generation for URL-prefixed docs content.

### Patch Changes

- 9bf1f94: Reorganize the docs into capability-led sections (Docs Pipeline, AEO & Agent Readability, Writing for Agents, Search & AI Answers, Package Docs, Integrations) with a new AEO overview page mapping every agent artifact to the agent-readability spec and scoring rubrics. Page URLs moved (`/docs/build/*` and `/docs/sources/*` → `/docs/pipeline|aeo|integrations/*`, `/docs/authoring/*` → `/docs/writing/*`); the bundled AGENTS.md and docs ship the new structure, and leadtype.dev serves 301 redirects from the old paths.
- 85a8893: Skip bot and automation authors when deriving generated markdown `lastAuthor`, falling back to the latest human commit for the file while preserving `lastModified` from the latest commit. Projects can add repo-specific automation names with `git.ignoredAuthors` in `docs.config.ts`.
- fa6d9b8: Exclude `shared/` and `_shared/` route segments from public docs search and answer sources by default, with `search: true` as an explicit opt-in for public shared pages.
- fc23b34: Emit `SoftwareApplication` alongside `SoftwareSourceCode` for library site JSON-LD so product identity checks can recognize documented packages.
- e61351a: Emit Agent Skills discovery manifests in the v0.2.0 format ($schema plus per-entry type/url/sha256-hex digest, with legacy path/integrity kept for older consumers) and support richer Organization JSON-LD identity fields from docs config — email, sameAs, contactPoint, and address — with fail-loud validation of unknown contactPoint/address keys.
- 4a61a33: Emit sitemap and robots artifacts at the site root only so generated crawler discovery files are effective without duplicate `/docs` copies.
- 100e4db: Fix docs search crashes and superlinear query latency on large corpora.

  Indexing a corpus containing terms that collide with `Object.prototype` members (for example a doc mentioning `constructor`) crashed `createDocsSearchIndex`, and querying such a term crashed `searchDocs` on a `JSON.parse`'d index. The term postings record is now built with a null prototype and query-time lookups (including synonym expansion) use `Object.hasOwn` guards.

  `searchDocs` also did a linear chunk scan and built an excerpt for every scored chunk, making query cost O(matched chunks × total chunks). Chunk-id lookups now use a cached map and excerpts are built only for results that survive the limit, with identical ranking. On a 20k-chunk corpus this cuts p95 query latency from ~665 ms to ~186 ms and makes latency scale linearly with corpus size.

## 0.2.1

### Patch Changes

- ac5f294: Support string-literal property names in `AutoTypeTable` extraction and add a real c15t docs repro pipeline for source-config driven generation.
- ac5f294: Add mount-aware docs generation for serving source subtrees at top-level URLs and allow root navigation page entries such as `"index"` without wrapping them in a group.
- ac5f294: Add `defineFrameworkNavigation` for shared framework docs sections.

## 0.2.0

### Minor Changes

- dd55845: Add `sourceConfig` inheritance for remote collections, making the pinned source
  docs UI path first-class.

  Docs UI repos can now set `sourceConfig: true` on a remote `defineCollection`
  to load `docs.config.{ts,js,mjs,cjs}` from the synced source collection and
  inherit source-owned `navigation`, legacy `groups`, `frontmatterSchema`, and
  `flatteners`. Explicit collection fields in the docs UI repo still win, while
  site-owned fields such as `product`, `organization`, `agents`, `llms`, output
  paths, and framework routes stay in the UI repo.

  Use this when a package/source repo owns MDX and docs semantics, but a separate
  docs UI repo owns rendering, deployment, and a reviewed source `ref`.

- e115ca0: Flesh out `/.well-known/agent-card.json` as a proper [A2A](https://agent2agent.info) AgentCard.

  It now emits the standard fields — `name`, `description`, `url` (the MCP endpoint when enabled,
  else the site), `version`, `capabilities`, `defaultInputModes`/`defaultOutputModes`, and each
  skill as `{ id, name, description, tags }` — plus `provider` and `documentationUrl`. `provider`
  reuses the top-level `organization` (same entity) and `documentationUrl` is `product.docs`
  (default `<baseUrl>/docs`); both are overridable. The previous non-standard `mcp` field is
  dropped (the MCP endpoint is now the standard `url`).

- e115ca0: Add an agent-skills surface: `/.well-known/agent-skills` + a bundled `SKILL.md` (DESIGN-2.md Phase 3).

  `leadtype generate` now emits a discoverable [`SKILL.md`](https://agentskills.io) surface (the
  open Agent Skills format used by Claude Code, Cursor, Codex, Copilot, …). Default-on:

  - **Site mode:** `/.well-known/agent-skills/index.json` (discovery manifest with `sha256` integrity)
    - `<name>/SKILL.md` per skill + a minimal `/.well-known/agent-card.json` (A2A).
  - **Bundle mode (`--bundle`):** a single `SKILL.md` at the package root, next to `AGENTS.md`.

  The auto **docs-skill** is a thin pointer that adapts to the surface — bundled `AGENTS.md`/`docs`
  offline, else `/llms.txt` + the MCP server when `agents.mcp.enabled`. Declare capability skills via
  `agents.skills.items[]` (`name`, `description`, `license?`, `compatibility?`, `allowedTools?`,
  `body`/`bodyPath`); `docsSkill: false` drops the auto one, `agentCard: false` skips the card. New
  `generateSkillArtifacts` exported from `leadtype/llm`.

  Dogfooded: `apps/example` emits the site surface (and now scores 100/100 on `leadtype score`);
  leadtype's own published tarball ships a `SKILL.md`.

- e115ca0: Make `renderSiteJsonLd` config-driven, and bake the JSON-LD options into the manifest.

  The site-level JSON-LD graph is derived from the top-level `organization` (→ `Organization`)
  and `product` (`kind`/`category`/`repository` → `SoftwareApplication`/`SoftwareSourceCode`),
  flowing through `generate` → `generateAgentReadabilityArtifacts` → the `agent-readability.json`
  manifest. `renderSiteJsonLd(manifest, overrides?)` reads it (explicit overrides still win), so a
  host emits the site graph once with `renderSiteJsonLd(manifest)` — no need to repeat the
  org/software options at the call site.

  Dogfooded in `apps/example`: the shared `docs.config.ts` sets `organization` + `product.kind:
"library"` (→ `SoftwareSourceCode`) + `agents.robots`, marks Changelog `optional: true`, and
  the root layout emits `renderSiteJsonLd(manifest)` so every page's `TechArticle` `@id`
  references resolve.

- e115ca0: Add the `agents.robots` config block to set the crawler policy from `leadtype.config`.

  ```ts
  defineDocsConfig({
    product: { name, summary },
    agents: {
      robots: { policy: "block-training", signals: { aiInput: "yes" } },
    },
  });
  ```

  `leadtype generate` reads `agents.robots.{policy,signals}` and threads them into the generated
  `robots.txt` (and its Content-Signal line). All fields optional — zero-config stays `balanced`.
  This is the additive `agents` block from the design; further keys (e.g. `jsonLd`) extend it.

- 4042306: Surface the root-`AGENTS.md` pointer as the headline bundle-setup step (closes #66).

  - `leadtype generate --bundle` now prints the consumer-pointer snippet on success (text mode only — `--json` output stays a clean machine record). The snippet is filled in with the package's installable npm name, read from the output package's `package.json` (falling back to the product name), so it works for scoped names too.
  - `leadtype init` now writes the root-`AGENTS.md` pointer by default, dogfooding the same pattern: it creates `AGENTS.md` if absent, refreshes a marker-delimited (`<!-- leadtype:start -->…<!-- leadtype:end -->`) block in place on re-run, or appends it to an existing file — never overwriting user content. Honors `--dry-run` and is listed in `--json` output. This points the agent helping you set up leadtype at leadtype's own bundled docs.
  - Docs lead with the pointer as required setup: the `Bundle docs into a package` guide opens with a two-step callout and a dedicated **Point consumers at the bundle** section, the README bundle path spells out the snippet, and the quickstart shows `init` emitting the pointer. All cite the eval result (bundle-read ~29% unprompted → ~90–100% with the pointer).

  Why: bundled docs only pay off when an agent actually reads them, and our evals show agents rarely discover the bundle on their own. The root pointer is the cheapest fix, so we now teach it at the point of use instead of burying it in the docs.

- 8b84f60: Add `collections` config and `leadtype sync` for declarative multi-source docs (closes #42, #44).

  - New `defineCollection({ repository?, ref?, cacheDir?, dir, prefix?, schema?, groups?, include?, exclude? })` helper, and `collections?: Record<string, DocsCollection>` on `DocsConfig`. Local-only collections omit `repository`; remote collections clone the repo at `ref` into `cacheDir` (default `.leadtype/sources/<repo-slug>@<ref>`). Multiple collections sharing a `(repository, ref)` pair share one clone.
  - New `leadtype sync` command: `--refresh` re-fetches and fast-forwards, `--offline` errors on cache miss, `--repo <pat>` filters by repository URL substring. State tracked in `<cacheDir>/.leadtype-sync.json`.
  - `leadtype generate` learns `--sync`, `--refresh`, `--offline` (mutually exclusive). Default behavior errors clearly when a remote cache is missing, naming the affected collection(s).
  - New project-level config: `leadtype.config.{ts,js,mjs,cjs}` looked up in cwd before the legacy per-docs-dir `docs.config.*` path. Setting both top-level `groups` and `collections` is rejected at load.
  - `leadtype lint` discovers `leadtype.config.ts` automatically and runs lint per collection, applying each collection's `schema` if set. Violations are prefixed with `[collection:<key>]`.
  - `git`-not-installed surfaces as an actionable message instead of a raw `ENOENT`.

  Legacy projects (single docs folder, top-level `groups` in `docs.config.ts`, `--docs-dir` flags) are unchanged — the legacy code path is byte-identical to before.

  Known limitation: `leadtype sync` has no built-in timeout; a long network stall will hang the process. Track via `Ctrl-C` for now; a configurable per-operation timeout is planned.

- aca9e8f: Add config-driven docs navigation with nested sections, explicit page placement,
  wildcard includes, and root-relative page references.

  `defineDocsConfig()` and `defineCollection()` now accept `navigation`, which is used by
  `resolveDocsNavigation()`, `llms.txt`, full-context generation, Agent
  Readability, `AGENTS.md`, source navigation, and CLI generation. Frontmatter
  `group` remains supported as taxonomy, validation metadata, and fallback
  navigation for projects that have not adopted `navigation`.

  This also updates the example docs site and c15t example to dogfood root
  `navigation` nodes as top-level docs areas, with the active root node's pages and
  children rendered as sidebar sections.

- e115ca0: Restructure `defineDocsConfig` around three clear concepts: **identity** (`product` + `organization`), **content** (`llms`), and **navigation** — so it's obvious what each field is for and where it ends up.

  **Breaking config changes** (all shipping in this release):

  | Before                                       | After                      |
  | -------------------------------------------- | -------------------------- |
  | `product.summary`                            | `product.tagline`          |
  | `product.blocks`                             | `llms.sections`            |
  | `nav` (top-level + per-collection)           | `navigation`               |
  | `agents.jsonLd.organization`                 | top-level `organization`   |
  | `agents.jsonLd.software.isLibrary`           | `product.kind: "library"`  |
  | `agents.jsonLd.software.applicationCategory` | `product.category`         |
  | `agents.skills.agentCard`                    | `agents.agentCard.enabled` |

  `product` is now pure identity (`name`, `tagline`, `homepage`, `docs`, `repository`, `kind`, `category`) reused across `llms.txt`, JSON-LD, and the agent card. `organization` (who publishes the product) feeds the JSON-LD `Organization` node and the agent-card `provider` — resolving the old ambiguity of whether `organization` meant the product or its maintainer. `product.repository` is emitted as JSON-LD `codeRepository`; `product.docs` becomes the agent-card `documentationUrl`.

  New exported helper `resolveAgentInputs(config)` translates the config's identity blocks into the low-level generator inputs (`generateLlmsTxt`, `generateAgentReadabilityArtifacts`, `generateSkillArtifacts`), so code composing those generators by hand shares one mapping with `leadtype generate`.

  Also fixes a latent bug where `leadtype generate` dropped the entire `agents` block during config validation (only the programmatic generator path honored it).

- eba1c1b: Add `defineComponentFlattener` for custom MDX → markdown flattening.

  Components outside the built-in naming contract previously required hand-writing
  a remark plugin in raw mdast. `defineComponentFlattener({ name, props, toMarkdown })`
  provides a high-level surface: declare prop coercion (`string`/`number`/`boolean`/`string[]`),
  receive children both as a flattened markdown string (`content`) and as
  already-flattened mdast nodes (`childNodes`), and build output with the new `b`
  builder namespace — or drop to the raw node for full control.

  Custom flatteners are scheduled in a new `custom` phase that runs after include
  and placeholder resolution but before the built-in flatteners, so
  `[...defaultMarkdownTransforms, myFlattener]` composes correctly regardless of array
  position. The flattening toolkit (`createJsxComponentProcessor`, node creators,
  `getAttributeValue`, `parseItemsArray`, `extractNodeText`, …) is now exported
  from `leadtype/markdown` as the escape hatch.

  `defineDocsConfig` and `defineCollection` gain a `flatteners` field, so custom
  flatteners apply to `leadtype generate` (CLI) output — every generated `.md` and
  the `llms` artifacts — not just the programmatic `convertAllMdx`/`createDocsSource`
  path. Top-level and per-collection `flatteners` are merged.

- e115ca0: Add GEO structure checks: `geo:*` lint rules + a `leadtype score` command.

  `leadtype lint` gains three warn-level rules — `geo:heading-skip` (a heading jumps a level),
  `geo:code-language` (an unlabeled code fence), `geo:image-alt` (an image with no alt text) —
  the mechanical half of the "Write for agents & GEO" guide.

  New **`leadtype score`** command (and `leadtype/score` → `scoreDocs`) rates the
  leadtype-addressable agent readiness of a generated build (0–100), mapped to the
  [ora](https://ora.ai/score) rubric so you can coach toward a high external scan. It scores
  **Identity** (llms.txt + `.well-known`, search index + manifest, sitemap/robots + Content-Signal,
  JSON-LD readiness, description coverage, the `geo:*` structure signals) and **Agent Integration**
  (MCP-ready artifacts, skills surface, offline docs); **Discovery / Auth & Access / User
  Experience** are shown but excluded with a pointer. It scores what leadtype emits + your doc
  structure — a local proxy, never live answer-engine ranking. `--json` for CI, `--min` to gate.

- e115ca0: JSON-LD: a referenced site-level entity graph + per-page `@id` references (DESIGN.md Phase 4).

  Per-page `renderJsonLd` now references the site entities by `@id`
  (`isPartOf: { "@id": ".../#website" }`, `publisher: { "@id": ".../#organization" }`) instead
  of re-inlining a `WebSite` on every page, and reference/api-section pages are typed
  `["TechArticle", "APIReference"]` automatically.

  New `renderSiteJsonLd(manifest, options?)` emits the site-level `@graph` once — `Organization`
  (canonical `@id`), `WebSite` with a `SearchAction`, and `SoftwareApplication` (or
  `SoftwareSourceCode` for libraries) — so an answer engine builds one entity graph. Options
  cover the organization name/url/logo, the software category, and the search URL template
  (`searchUrlPattern: null` to omit). Exported from `leadtype/llm` and `leadtype/llm/readability`.

  Behavior change: per-page JSON-LD `isPartOf` is now an `@id` reference; emit `renderSiteJsonLd`
  on a root page so it resolves.

- e115ca0: Add `leadtype/mcp` — a docs MCP server (stdio + Streamable HTTP) over the generated artifacts.

  A thin adapter over the existing search index + `.md` mirror, exposing two MCP tools: `search-docs(query, limit?)` (ranked `{ title, urlPath, snippet }`, wraps `searchDocs()`) and `get-page(urlPath)` (full Markdown, read from the `.md` mirror — byte-identical to content negotiation). `list-pages()` is optional, opt in via `tools`.

  - **`leadtype mcp`** — new CLI command. Runs the stdio server for local IDE clients (Claude Desktop, Cursor, Cline) over generated artifacts. `--artifacts <dir>` (default `./public`) or `--package <name>` to serve a dependency's bundled docs; `--tools <list>` to choose tools.
  - **`leadtype generate --bundle --mcp`** — opt-in flag that also emits `search-index.json` + `agent-readability.json` into the bundle, so a published tarball can serve a version-matched docs MCP server via `leadtype mcp --package <name>`. Off by default to keep bundles lean; the artifacts are URL-independent so they need no `--base-url`.
  - **`createMcpHandler(config)`** — a Web-standard `(Request) => Promise<Response>` handler the host mounts in its own route (Next, TanStack, SvelteKit, Nuxt, Astro, Workers). Stateless Streamable HTTP with JSON responses; **SSE is not emitted**. The host owns hosting — leadtype stays a layer.
  - Also exported: `createDocsMcpServer`, `runStdioServer`, `loadDocsArtifacts`, `resolveBundleArtifactsBase`, `defineDocsTools`.

  `@modelcontextprotocol/sdk` (SDK v1.x) is an **optional peer dependency**, imported lazily only when the server runs — it stays out of every install, and a missing install surfaces an actionable error rather than a module-not-found. Tool input schemas are validated with Valibot.

  Dogfooded in `apps/example`: a Nitro middleware mounts the server at `POST /mcp`, and `bun run mcp` serves the same docs over stdio.

  `leadtype` now exposes `./package.json` in its `exports` map (so `--package leadtype` can be resolved); `resolveBundleArtifactsBase` also falls back to walking up from the package entry for packages that don't. leadtype's own published tarball ships the MCP artifacts, so `leadtype mcp --package leadtype` serves version-matched docs out of the box.

  Gate: MCP earns its keep for large corpora / SDK docs where agents want targeted retrieval. For docs that fit in `llms-full.txt`, skip it.

- e923e9f: Add `leadtype/next` framework adapter and formalize the core/adapter boundary.

  `leadtype/next` exposes three server-only helpers for Next.js App Router: `createGenerateStaticParams(...)`, `createLoadPageData(...)`, and `createDocsRouteHandler(...)`. The route handler wraps `createAgentMarkdownResponse` so a docs app can serve raw markdown, handle `Accept: text/markdown` negotiation, and detect AI user agents from a one-line `route.ts`. The companion `leadtype/next/client` subpath exports a `useLeadtypeSearch` React hook plus a framework-free `createSearchClient` factory that lazy-loads `search-index.json` / `search-content.json` and runs BM25 per keystroke.

  `react` is now an optional peer dependency for `leadtype/next/client`. Server-only consumers never pull in React.

  Documents the core/adapter boundary in a new `docs/reference/architecture` page: leadtype core has zero framework runtime deps, adapters live at flat `leadtype/<framework>` subpaths, and **no leadtype package — core or adapter — ever ships rendered DOM**. State primitives (hooks, composables, stores, handler factories) are allowed; `<SearchBox>`-style components are not. The docs also name the planned native adapter shapes for Nuxt, SvelteKit, Astro, TanStack Start, Vue search, and Svelte search without exporting those APIs yet. The boundary is now enforced by tests in `packages/leadtype/src/internal/package-surface.test.ts` that scan import graphs and fail if framework runtimes leak into core or one adapter imports from another.

- e115ca0: Add a JSON-LD validity check to `leadtype lint`, plus an exported `validateJsonLd`.

  `leadtype lint` gains a `jsonld` rule (warn): it renders the identity fields each page's
  `TechArticle` is built from and structurally validates them, catching the common breakage —
  a `lastModified`/`last_updated` value that isn't a valid date, which would emit a broken
  `dateModified`. Broken schema is worse than none.

  `validateJsonLd(value)` is exported from `leadtype/llm` and `leadtype/llm/readability`: a
  structural validator (not a full Schema.org validator) that checks `@context`, `@type`, `@id`
  references, `url`, ISO dates, and that article-like nodes carry a headline/name — across a
  single object or a `@graph`. Returns a list of issues; empty means valid.

- 1670db8: Add `llms.sections` for composing rich, agent-friendly `llms.txt` and `AGENTS.md`.

  The top-level `llms.sections` array fully describes the body after the tagline
  blockquote. Each `LlmsBlock` is either a `markdown` block (verbatim body under an
  optional heading — use for an overview, popularity stats, hosting/credibility,
  community links) or a `links` block (a curated link list resolved against the
  source docs). Array order is file order, so authors can rename headings and place
  credibility content wherever indexers read first, without placement flags.

  `leadtype` does no data fetching — author-supplied values (e.g. stars/downloads)
  can be computed at build time in the config module.

  The example app and leadtype's own docs config now dogfood `llms.sections`, and
  the docs teach it as the way to author the product index.

- e115ca0: Add llms.txt discovery: `/.well-known/llms.txt` + `Link`/`X-Llms-Txt` response headers.

  `leadtype generate` now also writes a discovery copy of the root `llms.txt` at
  `/.well-known/llms.txt` (served statically from the output dir), so crawlers that probe
  the well-known location find the site index without guessing.

  `createMarkdownResponseHeaders` (and therefore `createAgentMarkdownResponse`) now advertise
  the index on every markdown response via `Link: </llms.txt>; rel="llms-txt"` and
  `X-Llms-Txt: /llms.txt`. Override the path with `llmsTxtPath` (e.g. `/docs/llms.txt`) or pass
  `llmsTxtPath: null` to omit the discovery headers. The mandatory `Vary: Accept` and
  `Content-Type: text/markdown; charset=utf-8` headers are unchanged.

  The generate JSON output reports the new path as `files.wellKnownLlmsTxt`.

- e115ca0: Support an `## Optional` section in `docs/llms.txt` via `optional: true` on a navigation node.

  Mark a navigation section "safe to drop for shorter context" and its pages collapse into a
  single trailing `## Optional` section in `docs/llms.txt` (the llms.txt convention for
  low-priority links) instead of getting their own heading. The flag applies to the whole subtree
  and is deduped by URL; it affects `docs/llms.txt` only — website navigation, sitemap, and
  search still list every page normally.

  ```ts
  navigation: [
    { title: "Reference", base: "reference", pages: [{ include: "*" }] },
    {
      title: "Changelog",
      base: "changelog",
      optional: true,
      pages: [{ include: "*" }],
    },
  ];
  ```

- e115ca0: Add `leadtype mcp --check` — test the MCP server with no client, SDK, or editor.

  Wiring up an IDE client just to confirm the docs MCP server returns the right pages was a pain.
  `leadtype mcp --check [--query "<term>"]` loads the artifacts and exercises the tools directly
  (reusing the SDK-free tool handlers), printing the exposed tools, the `search-docs` hits, and a
  `get-page` byte count, then exits 0. No `@modelcontextprotocol/sdk`, no JSON-RPC, no editor
  config. The usage text also points at `npx @modelcontextprotocol/inspector leadtype mcp …` for a
  full client UI.

- e115ca0: Add robots.txt AI-policy + Content-Signals (shared with the `Content-Signal` response header).

  `renderRobotsTxt` / `createRobotsTxtResponse` gain a `policy` that models the 2026
  train-vs-retrieve split and emits a Cloudflare `Content-Signal:` line:

  - `balanced` (default, zero-config) — fully crawlable + retrievable, but signals
    `ai-train=no`.
  - `open` — also welcomes training (`ai-train=yes`).
  - `block-training` — `Disallow: /` for training crawlers (GPTBot, Google-Extended, CCBot,
    ByteSpider, anthropic-ai, MetaExternalAgent); retrieval crawlers stay allowed.
  - `block-ai` — `Disallow: /` for every AI crawler; conventional search engines unaffected;
    signals `ai-input=no, ai-train=no`.

  `signals` overrides individual directives on top of a policy. The same vocabulary now also
  sets a `Content-Signal` response header on markdown responses (`createMarkdownResponseHeaders`
  / `createAgentMarkdownResponse`), defaulting to `balanced` — one stance, two emitters. New
  exports: `ContentSignals`, `RobotsPolicy`, `resolveContentSignals`, `renderContentSignal`.

  Zero-config behavior change: generated `robots.txt` and served markdown responses now carry
  `Content-Signal: search=yes, ai-input=yes, ai-train=no` by default.

- e115ca0: Add SEO/social head meta + `/.well-known/llms-full.txt` (DESIGN-2.md Phase 4).

  `createDocsHead` now also emits `og:type`, a `twitter:card`, and — from an `agents.seo` config
  block (baked into the manifest) with optional per-page overrides via its `seo` option —
  `og:image`/`twitter:image`, `twitter:site`, and `keywords`. leadtype emits the `og:image` URL,
  not the image (it ships no UI; generating a social card is the host's job). `SeoMeta` type added.

  `leadtype generate` now also writes a discovery copy of `llms-full.txt` at
  `/.well-known/llms-full.txt`, matching the existing `/.well-known/llms.txt`.

  Dogfooded in `apps/example` via `agents.seo` in the shared `docs.config.ts`.

- 4d23cb9: Tighten the default docs frontmatter metadata contract before launch.

  The default lint schema now uses `status` for editorial page state, accepts
  string `deprecated` messages, and adds `variants` plus `related` metadata for
  same-topic equivalents and see-also links. The old page lifecycle fields
  `deprecatedReason`, `experimental`, `canary`, `new`, `draft`, and
  `availableIn` are no longer part of the default docs-page schema. Model release
  channels with config or frontmatter transformers instead of source-authored page
  status.

### Patch Changes

- e115ca0: Clearer "no generated docs" error from `leadtype mcp` / `score`. It now lists all three fixes —
  run `leadtype generate`, point `--artifacts <dir>` at a generated `docs/` folder, or pass
  `--package <name>` for an installed package's bundled docs — and drops the misleading `mcp:`
  prefix (the loader is shared with `score`).
- c7fcbf6: Add first-class docs i18n support with locale-aware generation, localized source loading, per-locale search/LLM/readability artifacts, and a new `leadtype/i18n` helper surface. Locale-scoped search generation now uses URL-path document ids to align generated indexes with the source API.
- e115ca0: `createMcpHandler` never throws unhandled — all failures become a JSON-RPC 500 Response.

  Previously only artifact loading was guarded; a missing optional `@modelcontextprotocol/sdk`
  peer dep (or any transport error) escaped as an unhandled exception, surfacing as the host's
  generic 500. Now the whole request path is wrapped, so the client gets a clean JSON-RPC error
  with the actionable message (e.g. "install @modelcontextprotocol/sdk") instead of an opaque 500. Found by dogfooding the mounted route in `apps/example`'s production build.

- 7dd0f28: Reframe the docs/marketing pitch for bundling around the universal, defensible wins — cost and confident-wrong reduction — instead of raw accuracy (closes #68).

  The eval runs show the accuracy lift is modest and judge-sensitive for frontier models, while two wins hold for _every_ model: bundled docs cut per-run tokens 32–54%, and they stop agents confidently asserting the wrong behavior about your API. The copy now leads with those:

  - The README and docs landing (`index.mdx`) bundle paths, the `Bundle docs into a package` guide, and the package-docs card now lead with "agents run cheaper and stop confidently guessing wrong about your API," with accuracy framed by model tier ("biggest for the small, cheap models most agents run").
  - The `Evals` page reorders the package-benchmark section to present cost first, then confident-wrong, then accuracy-by-tier (with a confident-wrong table), instead of leading with the accuracy-lift table.

  Docs only — no API or behavior change. The reframed copy reaches consumers through the regenerated bundled docs in the published tarball.

- 844a94d: Default `<ExtractedTypeTable>` and `<AutoTypeTable>` path resolution to the Leadtype source root instead of `process.cwd()/docs`.

  This fixes generated docs for source roots such as `.c15t` or `.leadtype`, where `path="./packages/..."` should resolve against the configured source root. Source-MDX consumers can now pass `typeTableBasePath` / `typeTableStrict` through `createDocsSource()` or use `createMdxSourcePlugins()` for bundler-level configuration. Failed type extraction now emits a visible warning by default and can fail generation in strict mode.

  This changes the bare `mdxSourcePlugins` default for bundler consumers: when Leadtype can see the source MDX file path, it derives the base path from the first `docs` path segment instead of always using `process.cwd()/docs`. Projects that intentionally keep referenced TypeScript files under their docs folder should switch to `createMdxSourcePlugins({ typeTableBasePath: path.resolve(process.cwd(), "docs") })`.

## 0.1.2

### Patch Changes

- f7107d3: Ship the v1 headless integration surface plus docs polish.

  **New public API**

  - `createDocsSource({ contentDir })` at the root — framework-neutral docs source primitive returning navigation, page loading, search index, and standalone include resolution. Works with Next App Router, Astro, Vite + Vue/Solid/Svelte, Nuxt, SvelteKit, and any MDX-aware bundler.
  - `leadtype/mdx` subpath — typed prop contracts for every custom MDX tag (`CalloutProps`, `TabsProps`, `StepProps`, `TypeTableProps`, …) plus `mdxSourcePlugins` (a remark preset that expands `<include>` and resolves `<ExtractedTypeTable>` at build time while leaving custom tags as JSX). Framework-neutral — `children` is typed as `unknown` so consumers intersect with React/Vue/Svelte/Solid/Astro child types.
  - `leadtype/fumadocs` subpath — thin adapter mapping `createDocsSource()` to fumadocs-core's `Source` interface, including `meta.json` walking. `fumadocs-core >= 15` is an optional peer dependency.

  **New helpers**

  - `convertMdxFile(path, plugins)` from `leadtype/convert` — returns `{ ast, frontmatter, data, markdown }` in memory for a single MDX file.
  - `resolveInclude(specifier, options)` from `leadtype/mdx` — standalone include resolver, no remark transform required. Plus `parseIncludeSpecifier`, `extractMdxSection`, `resolveIncludePath`.
  - `remarkResolveTypeTableJsx` — source-preset variant of the type-table plugin that emits `<TypeTable properties={…} />` JSX (vs. the existing markdown-flattening variant).

  **Frontmatter contract**

  - New optional `order:` field. Pages with explicit order sort first within their group (ascending); pages without `order` fall back to alphabetical urlPath ordering. Conventionally numbered in tens for insertion room.

  **Navigation**

  - `resolveDocsNavigation` accepts an optional `docsDirName` config field (defaults to `"docs"`) for projects whose docs folder isn't named `docs/`.

  **Bug fixes**

  - Mermaid blocks in agent-flattened markdown no longer destroy `<br/>` line-break syntax (was being replaced with `/` and `-` in two passes). Mermaid renderers now receive valid syntax with multi-line node labels intact.
  - The mermaid plugin's outer-backtick stripper now handles the common `` chart={`flowchart LR\n...`} `` inline form, not just backticks-on-their-own-lines.

## 0.1.1

### Patch Changes

- 92192a7: Fix the CLI direct-run check so package-manager bin shims and symlinked workspace installs correctly run `leadtype generate`.
- 60c285c: Add first-class support for multiple docs source folders and custom URL mounts, including mounted search, LLM, and Agent Readability metadata. The generate command also expands include partials before emitting markdown artifacts, and extracted type tables resolve source paths from the original project root in multi-source builds.
- 1bca5cf: Shrink published install closure by swapping out heavier deps:

  - `gray-matter` → `vfile-matter` + `yaml` (drops `js-yaml`, `kind-of`, `section-matter`, `strip-bom-string` from the closure).
  - `jiti` moved from `dependencies` to optional `peerDependencies` — only required when authoring `docs.config.ts`; `.js`/`.mjs`/`.cjs` configs load via native `import()`.
  - `decode-named-character-reference` dropped — entity decode inside `<Steps>` titles now uses a small inline map.
  - `mdast-util-to-markdown` dropped in `prompt.remark` — serialization now goes through the existing `remark()` processor.
  - `mdast-util-compact` dropped in `steps.remark` — small in-tree adjacent-text/blockquote merge inlined.
  - `unist-builder` dropped — `u(...)` calls replaced with mdast object literals.
  - `unist-util-is` dropped — 7 `is(node, "type")` call sites switched to `node.type === "type"`.

  Behavior change: YAML frontmatter timestamps now round-trip through the `yaml` package's timestamp tag. Date-only scalars like `2026-04-19` emit as `2026-04-19` (compact) instead of `2026-04-19T00:00:00.000Z`. Datetime scalars without sub-second precision emit as `2026-04-19T12:00:00` instead of `2026-04-19T12:00:00.000Z`. The values remain `Date` instances in JS, so consuming code is unaffected.

- 3e03d9d: Replace `fast-glob` with `tinyglobby` to shrink the dependency tree (16 transitive deps → 3) and reduce install footprint (~1.2 MB → ~240 KB). Globbing behavior and call-site options are unchanged.

## 0.1.0

### Minor Changes

- 243f5ff: Release leadtype
