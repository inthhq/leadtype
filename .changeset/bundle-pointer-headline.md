---
"leadtype": minor
---

Surface the root-`AGENTS.md` pointer as the headline bundle-setup step (closes #66).

- `leadtype generate --bundle` now prints the consumer-pointer snippet on success (text mode only — `--json` output stays a clean machine record). The snippet is filled in with the package's installable npm name, read from the output package's `package.json` (falling back to the product name), so it works for scoped names too.
- `leadtype init` now writes the root-`AGENTS.md` pointer by default, dogfooding the same pattern: it creates `AGENTS.md` if absent, refreshes a marker-delimited (`<!-- leadtype:start -->…<!-- leadtype:end -->`) block in place on re-run, or appends it to an existing file — never overwriting user content. Honors `--dry-run` and is listed in `--json` output. This points the agent helping you set up leadtype at leadtype's own bundled docs.
- Docs lead with the pointer as required setup: the `Bundle docs into a package` guide opens with a two-step callout and a dedicated **Point consumers at the bundle** section, the README bundle path spells out the snippet, and the quickstart shows `init` emitting the pointer. All cite the eval result (bundle-read ~29% unprompted → ~90–100% with the pointer).

Why: bundled docs only pay off when an agent actually reads them, and our evals show agents rarely discover the bundle on their own. The root pointer is the cheapest fix, so we now teach it at the point of use instead of burying it in the docs.
