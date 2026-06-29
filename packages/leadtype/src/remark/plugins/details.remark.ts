import type { Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import {
  createHeading,
  createJsxComponentProcessor,
  extractNodeText,
  hasName,
  type MdxNode,
} from "../libs";

function extractSummary(child: RootContent): string | null {
  if (hasName(child, "summary")) {
    const extracted = extractNodeText(child.children).trim();
    return extracted.length > 0 ? extracted : null;
  }

  // MDX sometimes parses `<summary>...</summary>` (when followed by a blank
  // line) as a paragraph whose only child is the JSX element. Unwrap that.
  if (child.type !== "paragraph") {
    return null;
  }

  const [firstChild] = child.children;
  if (!(firstChild && hasName(firstChild, "summary"))) {
    return null;
  }

  const extracted = extractNodeText(firstChild.children).trim();
  return extracted.length > 0 ? extracted : null;
}

function toDetailsContent(node: MdxNode): RootContent[] {
  const content: RootContent[] = [];
  let summaryText: string | null = null;

  for (const child of node.children ?? []) {
    const extractedSummary = extractSummary(child as RootContent);
    if (extractedSummary) {
      summaryText = extractedSummary;
      continue;
    }

    content.push(child as RootContent);
  }

  if (summaryText) {
    return [createHeading(3, summaryText), ...content];
  }

  // Fallback heading so collapsible bodies don't appear as orphan content.
  if (content.length > 0) {
    return [createHeading(3, "Details"), ...content];
  }

  return content;
}

export function remarkDetailsToMarkdown(): Transformer<Root, Root> {
  return createJsxComponentProcessor("details", (node) =>
    toDetailsContent(node)
  );
}
