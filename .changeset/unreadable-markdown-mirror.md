---
"leadtype": minor
---

Tell a broken markdown mirror apart from a page that never existed.

`createAgentMarkdownResponse()` answered both with the same 200 "Page not found" body. That is right for one of them and wrong for the other. When the manifest lists a page, generation recorded that the page and its mirror exist — so a `readMarkdownFile` that comes back empty means a stale build output, a half-deployed asset host, or an adapter whose fetch failed. Reporting that as a missing page tells an agent a live URL is dead, and invites a CDN to cache the claim.

That case now answers `500` with `Cache-Control: no-store` and a body that says what actually happened, keeping the markdown `Content-Type`, canonical `Link`, and `llms-txt` discovery headers so the response stays readable, and sending no body for `HEAD`. The new `renderUnreadableMarkdown()` renders it. Adapters inherit this: a Next proxy whose markdown fetch fails for a manifest page now reports a server error instead of a soft miss. The core and framework handler configs also accept `onReadError(target, cause?)` for reporting rejected, empty, or invalid manifest-target reads without changing the stable response. Invalid manifest targets omit `target.filePath` and include the validation error as `cause`.

Routes with no page behind them — an explicit unknown `.md` path, or an agent-shaped request for a URL the manifest never listed — return 200 with the recovery body by default. Explicit `.md` paths enter recovery even without a Markdown `Accept` header or agent user-agent, so mount site-wide middleware after static routes or scope it when the host owns other `.md` routes. Leadtype's generated Agent Skills and agent-card paths are excluded and keep falling through to the static host. The new `missingStatus` option takes `200` (default) or `404` for sites where dead-link detection, crawl budgets, or monitoring matter more; the recovery body, canonical URL, and discovery links are identical at either status. Every framework adapter accepts it in its handler config.

`missingStatus` never touches the other outcomes: an existing page still returns 200, a renamed page 308, a removed page 410, and an unreadable mirror 500.

Manifest pages now also carry `markdownFilePath`, recording where the generator wrote each markdown mirror relative to the output directory. `resolveManifestMarkdownMirrorTarget()` returns it as `MarkdownMirrorTarget.filePath`, so both the docs-tree and bring-your-own-pages generators resolve their actual layouts. Older manifests keep using the previous `docs/<relativePath>.md` fallback.

For older bring-your-own-pages manifests, runtime readers retry the legacy root-relative mirror when the guessed `docs/` path is missing or throws. The retry is accepted only when its generator-owned `canonical_url` and `last_updated` frontmatter match the manifest page, preventing a stale root file from being served for an old mounted docs-tree manifest. A successful retry suppresses the guessed-path error; if both attempts fail, reporting preserves the original failure context.

The default-locale manifest may point at separately generated locale manifests without listing their pages itself. Pass those preloaded manifests through `localizedManifests`, keyed by locale code, to serve their pages. Cross-locale reads now require an exact page entry from the matching version-1 manifest and use its recorded `markdownFilePath`, including `index.md` storage. Missing or mismatched locale manifests and unlisted pages fail closed without probing a guessed path, so stale files left on disk are never served.

Generated filesystem paths may contain literal percent signs. Next proxy requests encode each path segment at the URL boundary, while encoded traversal and separator attempts remain rejected during manifest resolution.
