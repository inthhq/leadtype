---
"leadtype": patch
---

Route `leadtype generate` and `leadtype lint` through the same resolved project as doctor and the runtime.

Generate used to assemble a project of its own after sync, and lint read collections without running source-owned inheritance — so a remote collection with `inheritConfig: true` was checked against the defaults, and a stale checkout's `docs.config` could still be imported before the cache was verified. Both commands now call `resolveProjectFromLoaded`. Inheritance is applied; a missing or wrong-revision cache is a diagnostic naming `leadtype sync` rather than a silently empty lint or a module that should never have run.
