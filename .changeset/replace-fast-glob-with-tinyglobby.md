---
"leadtype": patch
---

Replace `fast-glob` with `tinyglobby` to shrink the dependency tree (16 transitive deps → 3) and reduce install footprint (~1.2 MB → ~240 KB). Globbing behavior and call-site options are unchanged.
