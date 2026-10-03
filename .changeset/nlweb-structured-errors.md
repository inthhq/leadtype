---
"leadtype": minor
---

Give the NLWeb `/ask` handler a machine-actionable failure contract.

Every non-2xx response now returns an NLWeb-shaped envelope with a leadtype-defined `error` extension: a stable `error.code`, a message, and a short `error.resolution`. The bodyless `204` answer to an `OPTIONS` preflight is the only exception, and failures stay JSON even when the request asked for streaming. `405` keeps its `Allow` header and gains the envelope; both carry the JSON content type and CORS headers.

Codes ship as `NLWEB_ERROR_CODES`: `invalid_json`, `invalid_request`, `request_too_large`, `missing_query`, `method_not_allowed`, `artifacts_unavailable`, and `internal_error`. A non-empty body that fails to parse is now `invalid_json` instead of being silently reported as a missing query, JSON that parses but isn't an `/ask` document — a non-object payload, or a `query`/`query_id` of the wrong type — is `invalid_request`, and a body over 16 KiB returns `413 request_too_large` with a size-specific recovery hint. An empty `POST` body still answers from the URL query.

`artifacts_unavailable` and `internal_error` responses are generic: the artifacts error no longer puts local directory paths in the HTTP body. A URL `query_id` is echoed on every failure. `POST` failures also accept the body field, so rejected requests can be correlated without making unsupported methods read their bodies.

Artifact validation now requires a content store, recomputes every stored chunk length from its selected content, and rejects empty or malformed posting lists before search. Corrupt indexes fail as `artifacts_unavailable` instead of returning plausible but misranked or empty answers.

Search artifact format version 3 persists each transformed chunk's code text alongside its visible content. Runtime validation can therefore recompute every title, heading, body, and code posting count exactly, rejecting missing, forged, or inflated weights. Regenerate version 2 search artifacts with this Leadtype release before deploying `/ask`.

Core search, browser clients, and MCP artifact loading validate that separately stored index and content artifacts have matching versions, timestamps, and chunk counts. During an in-place v2-to-v3 deployment, a mixed pair falls back to index-only search instead of crashing while the content artifact catches up. Browser clients do not retain that transient mismatch: a later search retries the pair and caches it once both artifacts match.

Request-body parsing is now strict. A malformed or non-object JSON body, an invalid `query`, or a non-string `query_id` returns `400` even when the URL contains a valid query; previously those bodies could be ignored and answered from URL parameters. Use the optional `onError` callback to send the original server-side error to your logger while keeping HTTP responses sanitized. A promise returned by the callback is awaited before the response is sent.

`POST` JSON bodies are capped at 16 KiB. Unsupported methods return `405` without consuming their bodies.

`NlwebAskResponse` is now a discriminated union of `NlwebAskAnswer` and `NlwebAskFailure` (narrow with `"error" in body`), with `NlwebAskError` and `NlwebErrorCode` exported alongside it.
