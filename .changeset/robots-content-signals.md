---
"leadtype": minor
---

Add robots.txt AI-policy + Content-Signals (shared with the `Content-Signal` response header).

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
