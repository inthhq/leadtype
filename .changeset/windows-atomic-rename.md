---
"leadtype": patch
---

Retry atomic artifact renames on Windows sharing violations (`EPERM`/`EACCES`/`EBUSY`) with short backoff, so `writeFileAtomic`/`copyFileAtomic` — and therefore `leadtype generate` — no longer fail when a concurrent reader (parallel build step, editor, antivirus scan) briefly holds an output file open.
