---
"leadtype": minor
---

Add `leadtype doctor` — a read-only explanation of the resolved project.

The other commands each answer a question about a project by doing something to it. None answered "what *is* this project, and why?" — which config was discovered, whether it resolved single-source or multi-repo, which values were authored versus inherited versus inferred, which collections share one clone, what routes will exist, and which command fixes what is currently wrong.

Doctor never clones, refreshes, writes, or generates, so an unsynced remote is a finding naming `leadtype sync` rather than a fetch. Everything it reports comes from the same config loader and resolvers `generate` and `sync` use, so a clean doctor run and a clean generate run cannot disagree.

Checks cover config discovery and provenance, deprecated aliases, the deduped acquisition graph with pinned-versus-mutable refs and cache freshness, collection directories and include globs, the resolved navigation tree and pages that fall back to the root instead of being placed, expected output artifacts and their staleness, the detected framework adapter, and enabled agent surfaces.

Human output is concise and every finding names its owning config field and a concrete next command. `--json` carries stable finding ids and provenance so agents can act without parsing prose. Exit `0` when nothing is an error, `1` when a required input is missing or invalid.
