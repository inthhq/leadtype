import type { Root } from "mdast";
import type { Transformer } from "unified";
import { visit } from "unist-util-visit";

function isJsxComment(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().startsWith("/*") &&
    value.trim().endsWith("*/")
  );
}

export function remarkRemoveJsxComments(): Transformer<Root, Root> {
  return (tree) => {
    visit(
      tree,
      ["mdxFlowExpression", "mdxTextExpression"],
      (node, index, parent) => {
        if (!parent || typeof index !== "number") {
          return;
        }

        if (!isJsxComment((node as { value?: unknown }).value)) {
          return;
        }

        parent.children.splice(index, 1);
        // Re-visit at the same index so adjacent comments are also removed.
        return index;
      }
    );
  };
}
