---
"leadtype": minor
---

Add `resolveProject()` — one function for the whole config pipeline.

Answering "what is this project?" takes five ordered steps: discover the config, apply source-owned inheritance, normalize to canonical names, derive what wasn't authored, and resolve each collection's content directory through the sync cache. `generate`, `doctor`, `nav`, and `createDocsProject` each assembled those by hand, and `doctor` and `nav` shipped with the *same two* bugs as a result — both skipped inheritance, and both resolved a remote collection's `dir` against the config directory rather than its checkout.

They now read one resolved project. It throws only for a malformed config; everything environmental — an unsynced source, a missing directory, unreadable source config — is a diagnostic carrying a stable id, the owning config field, and the command that fixes it. That split is what lets `doctor` report a problem and keep going while `createDocsProject` refuses to hand a renderer a source it cannot read.

`createDocsProject()` no longer needs a config passed to it: it discovers `leadtype.config.*` or `docs.config.*` the same way the CLI does, so an app with a config file doesn't import it just to hand it back.

```ts
export const source = await createDocsProject({ baseUrl: "https://example.com" });
```

Config loading also moves out of the CLI into `leadtype`'s config module, so the runtime no longer reaches through the generate pipeline to answer which config describes a project.
