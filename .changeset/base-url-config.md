---
"leadtype": minor
---

Make `baseUrl` a config field, so the common path stops repeating it.

A docs audit found `baseUrl` was the one value every snippet had to state twice — `generate --base-url https://…` for the CLI and `createDocsProject({ baseUrl })` for the runtime — because it was not part of the config. It now is: a site-owned, top-level field next to `product`.

```ts
export default defineDocsConfig({
  product: { name: "Acme", tagline: "Acme does one useful thing." },
  baseUrl: "https://acme.dev",
});
```

With it set, the scaffolded common path carries no knobs at all: `leadtype generate` needs no `--base-url`, and the runtime is `createDocsProject()` with zero arguments. `leadtype init` writes the value once, into `docs/docs.config.ts`, and nowhere else.

Precedence is explicit-wins, and nothing changes for existing setups: the `--base-url` flag and the `createDocsProject({ baseUrl })` argument override the config field, and a config without the field keeps the deployment-URL env fallbacks exactly as before. The value is validated at load (absolute http(s) URL, optional path prefix, no query or fragment) and normalized (trailing slashes stripped), so URL joins cannot produce `//`.

Because a base URL says where *this* site publishes, the field is never inherited via `inheritConfig` — a source-owned `docs.config.*` consumed by several sites should leave it unset and let each site supply its own.

The resolved value is inspectable like every other derived-or-authored value: provenance carries a `baseUrl` entry (`explicit` with the config path, or `default` naming the env fallback chain), `leadtype doctor` reports the resolved URL and its origin, and `generate --explain` reports the fallback when nothing was authored anywhere.
