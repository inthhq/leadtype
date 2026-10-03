import type { Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import { visit } from "unist-util-visit";
import { hasName } from "../libs";

export function sectionToMarkdown(node: {
  children?: unknown[];
}): RootContent[] {
  return (node.children ?? []) as RootContent[];
}

export function remarkSectionToMarkdown(): Transformer<Root, Root> {
  return (tree) => {
    visit(
      tree,
      ["mdxJsxFlowElement", "mdxJsxTextElement"],
      (node, index, parent) => {
        if (!parent || typeof index !== "number" || !hasName(node, "section")) {
          return;
        }

        // Section attributes (e.g. `id="types"`) are intentionally dropped —
        // this output is consumed by LLMs/llms.txt, not browsers that resolve anchors.
        parent.children.splice(index, 1, ...sectionToMarkdown(node));

        // Re-visit at the same index so nested <section> wrappers also unwrap.
        return index;
      }
    );
  };
}
