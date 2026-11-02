---
"leadtype": patch
---

Support `ssh://` and `git://` protocol URLs (including ports and credentials) in `repositorySlug`. Previously, `repositorySlug` only matched `https?://` before falling back to `SCP_LIKE_GIT_URL`, which split on the first colon in `ssh:`, yielding malformed cache slugs like `---git-github-com-org-repo` instead of `org-repo`.
