---
"leadtype": minor
---

Add the `agents.robots` config block to set the crawler policy from `leadtype.config`.

```ts
defineDocsConfig({
  product: { name, summary },
  agents: {
    robots: { policy: "block-training", signals: { aiInput: "yes" } },
  },
});
```

`leadtype generate` reads `agents.robots.{policy,signals}` and threads them into the generated
`robots.txt` (and its Content-Signal line). All fields optional — zero-config stays `balanced`.
This is the additive `agents` block from the design; further keys (e.g. `jsonLd`) extend it.
