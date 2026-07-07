---
"leadtype": minor
---

Batch Git frontmatter enrichment during `convertAllMdx` (closes #108).

When `enrichFrontmatterFromGit` is enabled, batch conversion now reads Git history once for the docs tree and maps results back to each converted file instead of spawning `git log` per file. A 120-file synthetic docs benchmark measured the Git metadata read dropping from ~2.36s of per-file process spawning to ~12ms for the batched read; end-to-end conversion added ~27ms over no enrichment.

The enrichment remains best-effort for shallow clones, missing Git, and untracked files. `lastModified` still comes from the latest file commit, while `lastAuthor` now falls back to the latest non-bot author when the newest commit was authored by automation.
