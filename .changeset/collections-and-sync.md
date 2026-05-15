---
"leadtype": minor
---

Add `collections` config and `leadtype sync` for declarative multi-source docs (closes #42, #44).

- New `defineCollection({ repository?, ref?, cacheDir?, dir, prefix?, schema?, groups?, include?, exclude? })` helper, and `collections?: Record<string, DocsCollection>` on `DocsConfig`. Local-only collections omit `repository`; remote collections clone the repo at `ref` into `cacheDir` (default `.leadtype/sources/<repo-slug>@<ref>`). Multiple collections sharing a `(repository, ref)` pair share one clone.
- New `leadtype sync` command: `--refresh` re-fetches and fast-forwards, `--offline` errors on cache miss, `--repo <pat>` filters by repository URL substring. State tracked in `<cacheDir>/.leadtype-sync.json`.
- `leadtype generate` learns `--sync`, `--refresh`, `--offline` (mutually exclusive). Default behavior errors clearly when a remote cache is missing, naming the affected collection(s).
- New project-level config: `leadtype.config.{ts,js,mjs,cjs}` looked up in cwd before the legacy per-docs-dir `docs.config.*` path. Setting both top-level `groups` and `collections` is rejected at load.
- `leadtype lint` discovers `leadtype.config.ts` automatically and runs lint per collection, applying each collection's `schema` if set. Violations are prefixed with `[collection:<key>]`.
- `git`-not-installed surfaces as an actionable message instead of a raw `ENOENT`.

Legacy projects (single docs folder, top-level `groups` in `docs.config.ts`, `--docs-dir` flags) are unchanged — the legacy code path is byte-identical to before.

Known limitation: `leadtype sync` has no built-in timeout; a long network stall will hang the process. Track via `Ctrl-C` for now; a configurable per-operation timeout is planned.
