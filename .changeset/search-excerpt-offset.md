---
"leadtype": patch
---

Anchor search result excerpts on the match in the original text. `buildExcerpt` located the query inside the NFKD-normalized text and then sliced the raw text with that offset, but NFKD is not length-preserving (`…` → `...`, `½` → `1⁄2`, `ﬁ` → `fi`, CJK compatibility forms), so the excerpt window drifted past the match — far enough on some chunks that the excerpt came back as just `...`.
