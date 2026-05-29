---
"leadtype": minor
---

Add `defineComponentFlattener` for custom MDX → markdown flattening.

Components outside the built-in naming contract previously required hand-writing
a remark plugin in raw mdast. `defineComponentFlattener({ name, props, toMarkdown })`
provides a high-level surface: declare prop coercion (`string`/`number`/`boolean`/`string[]`),
receive children both as a flattened markdown string (`content`) and as
already-flattened mdast nodes (`childNodes`), and build output with the new `b`
builder namespace — or drop to the raw node for full control.

Custom flatteners are scheduled in a new `custom` phase that runs after include
and placeholder resolution but before the built-in flatteners, so
`[...defaultRemarkPlugins, myFlattener]` composes correctly regardless of array
position. The flattening toolkit (`createJsxComponentProcessor`, node creators,
`getAttributeValue`, `parseItemsArray`, `extractNodeText`, …) is now exported
from `leadtype/remark` as the escape hatch.

`defineDocsConfig` and `defineCollection` gain a `flatteners` field, so custom
flatteners apply to `leadtype generate` (CLI) output — every generated `.md` and
the `llms` artifacts — not just the programmatic `convertAllMdx`/`createDocsSource`
path. Top-level and per-collection `flatteners` are merged.
