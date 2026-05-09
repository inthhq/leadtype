import type { Root } from "mdast";
import type { MdxjsEsm } from "mdast-util-mdxjs-esm";
import type { Transformer } from "unified";
import { visit } from "unist-util-visit";

// Precompiled regex for performance and lint compliance
const IMPORT_STATEMENT_PATTERN = /^\s*import\s/m;
const EXPORT_STATEMENT_PATTERN = /^\s*export\s/m;

export function remarkRemoveImports(): Transformer<Root, Root> {
  return (tree) => {
    visit(tree, "mdxjsEsm", (node: MdxjsEsm, index, parent) => {
      if (
        parent === null ||
        parent === undefined ||
        index === null ||
        index === undefined
      ) {
        return;
      }
      const value = node.value ?? "";

      // Check if this node contains import statements
      if (IMPORT_STATEMENT_PATTERN.test(value)) {
        // Split the content into lines to analyze each statement
        const lines = value
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        // Check if this node contains ONLY import statements
        const hasOnlyImports = lines.every((line) =>
          IMPORT_STATEMENT_PATTERN.test(line)
        );
        const hasExports = lines.some((line) =>
          EXPORT_STATEMENT_PATTERN.test(line)
        );

        // Only remove the node if it contains ONLY imports and no exports
        if (hasOnlyImports && !hasExports) {
          parent.children.splice(index, 1);
          return index;
        }
        // If it contains mixed content (imports + exports), leave it intact
        // This preserves exports even when imports are present in the same node
      }
    });
  };
}
