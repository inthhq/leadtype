---
"leadtype": minor
---

Add a canonical config vocabulary and one resolved-config normalizer.

`defineLeadtypeConfig` names the project/site config in `leadtype.config.ts`, alongside `defineDocsConfig` for a source repo's content-owned `docs.config.ts`. Three collection fields are renamed: `prefix` → `routePrefix`, `sourceConfig` → `inheritConfig`, `schema` → `frontmatterSchema`.

Every existing config keeps working. Both spellings normalize to one internal `ResolvedDocsConfig` that generate, sync, lint, score, and the runtime source all read, so no subsystem re-derives the project from raw config. The resolved shape adds a deduped source graph — collections sharing a `(repository, ref)` resolve to one acquisition — and per-field provenance recording whether each value was authored, inherited from a source repo, inferred, or defaulted.

Deprecated fields carry `@deprecated` guidance in the IDE and warn once per config file at load. Setting an old name and its replacement together is an error naming both rather than a silent precedence rule. Nothing is removed before 1.0.
