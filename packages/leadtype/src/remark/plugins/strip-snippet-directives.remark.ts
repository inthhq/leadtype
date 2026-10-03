import type { Root } from "mdast";
import type { Transformer } from "unified";
import { visit } from "unist-util-visit";

/**
 * Strip twoslash-style lint directives from fenced code blocks so the
 * authoring convention never reaches rendered or generated output:
 *
 * - `// @noErrors`, `// @check`, `// @filename: ...` lines are removed
 * - `// ---cut---` hides everything above it (twoslash display semantics —
 *   the hidden lines still typecheck during lint, readers only see what
 *   follows the cut)
 */

const DIRECTIVE_LINE_PATTERN =
  /^\s*\/\/\s*@(?:noErrors\b|check\b|filename:).*$/;
const CUT_LINE_PATTERN = /^\s*\/\/\s*---cut---\s*$/;

export function stripSnippetDirectives(value: string): string {
  let lines = value.split("\n");
  // findLastIndex needs a newer lib target than the package floor — walk
  // manually.
  let lastCut = -1;
  for (const [index, line] of lines.entries()) {
    if (CUT_LINE_PATTERN.test(line)) {
      lastCut = index;
    }
  }
  if (lastCut !== -1) {
    lines = lines.slice(lastCut + 1);
  }
  return lines
    .filter((line) => !DIRECTIVE_LINE_PATTERN.test(line))
    .join("\n")
    .replace(/^\n+/, "");
}

export function remarkStripSnippetDirectives(): Transformer<Root, Root> {
  return (tree) => {
    visit(tree, "code", (node) => {
      const code = node as { value?: unknown };
      if (typeof code.value !== "string") {
        return;
      }
      const stripped = stripSnippetDirectives(code.value);
      if (stripped !== code.value) {
        code.value = stripped;
      }
    });
  };
}
