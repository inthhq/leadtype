---
"leadtype": patch
---

Skip bot and automation authors when deriving generated markdown `lastAuthor`, falling back to the latest human commit for the file while preserving `lastModified` from the latest commit. Projects can add repo-specific automation names with `git.ignoredAuthors` in `docs.config.ts`.
