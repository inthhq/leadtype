import type { Code, Root } from "mdast";
import type { Transformer } from "unified";
import { visit } from "unist-util-visit";
import {
  extractNodeText,
  getAttributeValue,
  hasName,
  type MdxNode,
} from "../libs";

// Precompiled regexes
const ESCAPED_NL = /\\n/g; // "\\n" -> actual newline
const CRLF = /\r\n/g; // CRLF -> LF
const LEADING_BACKTICK = /^`+/; // backticks at the very start (after trim)
const TRAILING_BACKTICK = /`+$/; // backticks at the very end (after trim)
const TRAILING_WHITESPACE = /[ \t]+$/; // trailing spaces/tabs on a line
const LEADING_BLANK_LINES = /^\s*\n+/; // one or more blank lines at start
const TRAILING_BLANK_LINES = /\n+\s*$/; // one or more blank lines at end

function cleanMermaidSource(raw: string): string {
  // Step 1: Normalize CRLF to LF
  let s = raw.replace(CRLF, "\n");

  // Step 2: Convert escaped newlines
  s = s.replace(ESCAPED_NL, "\n");

  // NOTE: `<br/>` is mermaid's own syntax for line breaks inside node labels.
  // We intentionally leave it untouched — replacing it would break diagrams
  // for any downstream mermaid renderer (agents that render mermaid get the
  // correct multi-line labels; agents that don't render mermaid skip the
  // code fence entirely).

  // Step 3: Strip outer blank lines (not leading spaces, which mermaid uses
  // for hierarchy)
  s = s.replace(LEADING_BLANK_LINES, "").replace(TRAILING_BLANK_LINES, "");

  // Step 4: Strip the wrapping template-literal backticks. Author MDX usually
  // writes `<Mermaid chart={`flowchart LR\n  ...\n  src --> app`} />` so the
  // attribute value comes through with backticks inline with the first/last
  // statement. The old regex required the backticks on their own lines and
  // missed this common form.
  s = s.replace(LEADING_BACKTICK, "").replace(TRAILING_BACKTICK, "");

  // Step 5: Split into lines, trim only trailing whitespace from each line, rejoin
  // (preserving leading indentation)
  s = s
    .split("\n")
    .map((line) => line.replace(TRAILING_WHITESPACE, ""))
    .join("\n");

  return s;
}

function toMermaidCode(value: string): Code {
  return { type: "code", lang: "mermaid", value };
}

function extractMermaidContent(node: MdxNode): string {
  const chartAttr = getAttributeValue(node, "chart");
  const fromChildren = extractNodeText(node.children || []);
  const src =
    chartAttr && chartAttr.trim().length > 0 ? chartAttr : fromChildren;
  return src ? cleanMermaidSource(src) : "";
}

export function remarkMermaidToMarkdown(): Transformer<Root, Root> {
  return (tree) => {
    visit(
      tree,
      ["mdxJsxFlowElement", "mdxJsxTextElement"],
      (node, index, parent) => {
        if (!parent || typeof index !== "number" || !hasName(node, "Mermaid")) {
          return;
        }

        const value = extractMermaidContent(node);

        // Remove empty Mermaid nodes completely
        if (!value) {
          parent.children.splice(index, 1);
          return index;
        }

        const code = toMermaidCode(value);
        parent.children[index] = code;
      }
    );
  };
}
