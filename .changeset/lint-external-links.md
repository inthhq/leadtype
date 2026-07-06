---
"leadtype": minor
---

Add the opt-in `external-link` lint rule — the scheduled-CI half of the
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
