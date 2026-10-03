import { defineComponentFlattener } from "leadtype/markdown";

/**
 * Demonstrates a custom (non-contract) component flattened for agents.
 *
 * `<Regulation region="GDPR">…</Regulation>` renders as a styled note in the
 * browser (see each app's runtime component map) and flattens to a labeled
 * blockquote in the generated agent markdown / llms artifacts. This is the
 * dogfood for `defineComponentFlattener` + the config `flatteners` field.
 */
export const regulationFlattener = defineComponentFlattener({
  name: "Regulation",
  props: { region: "string" },
  toMarkdown: ({ props, content, b }) => {
    const label = props.region ?? "Regulation";
    return b.blockquote([
      content ? `**${label}** — ${content}` : `**${label}**`,
    ]);
  },
});
