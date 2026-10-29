---
"leadtype": patch
---

`sync --refresh` now re-clones a cached checkout when updating it in place fails. Before, a cache whose manifest matched but whose git objects were missing, as after a partial cache restore or an interrupted sync, failed on every run with errors like `git checkout <sha> failed ... fatal: unable to read tree`, because fetching doesn't restore those objects and the re-clone path only ran when the manifest didn't match. The recovered source is reported as `cloned`.
