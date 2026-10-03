---
"leadtype": patch
---

Make `leadtype sync` consume the resolved source graph instead of rebuilding one.

`resolveSources` (what doctor and `generate --json` report) and `resolveRemoteSources` (what sync cloned from) used the same `(repository, ref)` key with different rules, so a config could look coherent in doctor and then fail at clone time — or worse, look coherent and sync the wrong checkout. Three of those gaps were real: collections that disagreed on `sparse` merged silently, a mix of explicit and default `cacheDir` resolved one way in normalize and the other in sync, and a git source named `local` collided with the implicit local source.

Those checks now live in `resolveSources`. A shared acquisition must agree on its sparse set and its cache directory (compared as resolved paths, so spelling out the default location is still valid). Duplicate source ids are rejected at config load. `syncSources` projects that graph; it no longer decides identity. Configs that already synced keep the same clone layout, manifests, and output. Configs that could not sync now fail when the config loads, with the same specifics, instead of only when `leadtype sync` runs.
