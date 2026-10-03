import type { Blockquote, ListItem, Node, Paragraph, Root, Table } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import {
  createJsxComponentProcessor,
  createOrderedList,
  createStrongParagraph,
  getAttributeValue,
  hasName,
  type MdxNode,
  normalizeWhitespace,
  processContentNode,
} from "../libs";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  copy: "©",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
};

/**
 * Decode HTML entities in text (both named and numeric character references).
 * Named entities are limited to the common set above; rare ones are left as-is,
 * matching the existing behavior for entities the previous library couldn't resolve.
 */
function decodeText(text: string): string {
  const HEX_PREFIX_LENGTH = 2; // Length of "#x" prefix
  const DECIMAL_PREFIX_LENGTH = 1; // Length of "#" prefix
  const HEX_RADIX = 16;
  const DECIMAL_RADIX = 10;
  const UNICODE_MAX_CODE_POINT = 0x10_ff_ff; // Maximum valid Unicode code point
  const SURROGATE_MIN = 0xd8_00; // Start of Unicode surrogate range
  const SURROGATE_MAX = 0xdf_ff; // End of Unicode surrogate range

  const decodedText = text.replace(
    /&(#x?[0-9A-Fa-f]+|[a-zA-Z][a-zA-Z0-9]+);/g,
    (_m: string, ent: string): string => {
      // Numeric: &#123; or &#x1F4A9;
      if (ent[0] === "#") {
        const isHex = ent[1]?.toLowerCase() === "x";
        const num = Number.parseInt(
          ent.slice(isHex ? HEX_PREFIX_LENGTH : DECIMAL_PREFIX_LENGTH),
          isHex ? HEX_RADIX : DECIMAL_RADIX
        );
        const isInteger = Number.isInteger(num);
        const inUnicodeRange =
          isInteger &&
          num >= 0 &&
          num <= UNICODE_MAX_CODE_POINT &&
          !(num >= SURROGATE_MIN && num <= SURROGATE_MAX); // exclude surrogate range
        return inUnicodeRange ? String.fromCodePoint(num) : `&${ent};`;
      }
      // Named — use a small map of common entities; pass through the rest.
      return NAMED_ENTITIES[ent] ?? `&${ent};`;
    }
  );
  return normalizeWhitespace(decodedText);
}

// Use shared createStrongParagraph function from remark-libs

/**
 * Type guard for Step JSX element
 */
function isStepNode(node: unknown): node is MdxNode {
  if (typeof node !== "object" || node === null) {
    return false;
  }

  const type = (node as { type?: unknown }).type;
  const isJsxElement =
    type === "mdxJsxFlowElement" || type === "mdxJsxTextElement";
  if (!isJsxElement) {
    return false;
  }

  return hasName(node, "Step");
}

/**
 * Extract title from a Step node, preferring title attribute over content
 */
function extractStepTitle(
  step: MdxNode
): { title: string; titleNode: Node | null } | null {
  // Prefer explicit title attribute; fall back to first heading/paragraph/text
  const attrTitleRaw = (getAttributeValue(step, "title") ?? "").trim();

  if (attrTitleRaw) {
    const title = decodeText(attrTitleRaw);
    return title ? { title, titleNode: null } : null;
  }

  const children = (step.children ?? []) as unknown[] as Node[];
  const titleNode =
    children.find((c) => c.type === "heading" || c.type === "paragraph") ??
    children.find((c) => c.type === "text" || c.type === "mdxTextExpression") ??
    null;
  if (!titleNode) {
    return null;
  }
  const title = decodeText(mdastToString(titleNode));
  return title ? { title, titleNode } : null;
}

/**
 * Get content nodes that come after the title node
 */
function getContentNodes(step: MdxNode, titleNode: Node | null): Node[] {
  const children = (step.children ?? []) as unknown[] as Node[];
  let startIdx = -1;
  if (titleNode) {
    startIdx = children.indexOf(titleNode);
  }
  return startIdx >= 0 ? children.slice(startIdx + 1) : children;
}

// Helper function to process content nodes and build list item children
function processContentNodesForListItem(
  contentNodes: Node[],
  titleParagraph: Paragraph,
  listItemChildren: (Paragraph | Table | Blockquote | Node)[]
): void {
  if (contentNodes.length === 0) {
    return;
  }

  // Special handling for table nodes - keep them as separate elements
  const firstContentNode = contentNodes[0];
  let startIndex = 1; // Default starting index for the remaining nodes loop

  if (firstContentNode && firstContentNode.type === "table") {
    // For tables, keep them as separate elements (don't inline with title)
    listItemChildren.push(firstContentNode);
  } else if (firstContentNode && firstContentNode.type === "paragraph") {
    // Preserve inline formatting (code, links, strong) when folding the
    // leading paragraph into the step title — using mdastToString flattens
    // everything to plain text.
    const inlineChildren = (firstContentNode as Paragraph).children ?? [];
    if (inlineChildren.length > 0) {
      titleParagraph.children.push(
        { type: "text", value: " " },
        ...inlineChildren
      );
    }
    startIndex = 1;
  } else if (firstContentNode) {
    // For other block-level content (blockquote, code, list, etc.),
    // process as separate element and start remaining loop from index 1
    const processedFirstNode = processContentNode(firstContentNode);
    if (processedFirstNode) {
      listItemChildren.push(processedFirstNode);
    }
    // Start processing remaining nodes from index 1
    startIndex = 1;
  }

  // Add remaining content nodes as separate elements
  for (let i = startIndex; i < contentNodes.length; i++) {
    const node = contentNodes[i];
    if (!node) {
      continue;
    }
    const contentNode = processContentNode(node);
    if (contentNode) {
      listItemChildren.push(contentNode);
    }
  }
}

/**
 * Convert a Step node to a list item
 */
function stepToListItem(step: MdxNode): ListItem | null {
  const titleResult = extractStepTitle(step);
  if (!titleResult) {
    return null;
  }

  const { title, titleNode } = titleResult;
  const contentNodes = getContentNodes(step, titleNode);

  // Handle special case: if first paragraph was used as title and there are no following siblings
  if (
    contentNodes.length === 0 &&
    titleNode &&
    titleNode.type === "paragraph"
  ) {
    return {
      type: "listItem",
      children: [createStrongParagraph(title)],
    } as ListItem;
  }

  // Create the title paragraph
  const titleParagraph: Paragraph = {
    type: "paragraph",
    children: [{ type: "strong", children: [{ type: "text", value: title }] }],
  };

  // If no additional content, just return the title
  if (contentNodes.length === 0) {
    return {
      type: "listItem",
      children: [titleParagraph],
    } as ListItem;
  }

  // Create list item children array
  const listItemChildren: (Paragraph | Table | Blockquote | Node)[] = [
    titleParagraph,
  ];

  // Process content nodes
  processContentNodesForListItem(
    contentNodes,
    titleParagraph,
    listItemChildren
  );

  return {
    type: "listItem",
    children: listItemChildren,
  } as ListItem;
}

/**
 * Process Steps node children to extract list items
 */
function processStepsNode(node: MdxNode): ListItem[] {
  const listItems: ListItem[] = [];

  const pushStep = (candidate: unknown): void => {
    if (!isStepNode(candidate)) {
      return;
    }
    const listItem = stepToListItem(candidate);
    if (listItem) {
      listItems.push(listItem);
    }
  };

  for (const child of node.children ?? []) {
    if (isStepNode(child)) {
      pushStep(child);
      continue;
    }
    if (child.type === "paragraph") {
      // When Steps content is inline-indented, MDX wraps <Step> elements in a
      // paragraph. Drill one level to find them.
      const paragraphChildren =
        (child as { children?: unknown[] }).children ?? [];
      for (const paragraphChild of paragraphChildren) {
        pushStep(paragraphChild);
      }
    }
  }

  return listItems;
}

/**
 * Merge adjacent text nodes and blockquotes in place. Mirrors the small subset
 * of mdast-util-compact behavior that this plugin relies on.
 */
export function compactStepTree(tree: Root): void {
  visit(tree, (child, index, parent) => {
    if (
      !parent ||
      index === null ||
      index === undefined ||
      index === 0 ||
      (child.type !== "text" && child.type !== "blockquote")
    ) {
      return;
    }
    const previous = parent.children[index - 1];
    if (!previous || previous.type !== child.type) {
      return;
    }
    if ("value" in child && "value" in previous) {
      (previous as { value: string }).value += child.value;
    }
    if ("children" in child && "children" in previous) {
      (previous as { children: Node[] }).children = [
        ...(previous as { children: Node[] }).children,
        ...(child.children as Node[]),
      ];
    }
    parent.children.splice(index, 1);
    return index;
  });
}

/**
 * Remark plugin to convert Steps JSX elements to numbered markdown lists
 */
export const remarkStepsToMarkdown: Plugin<[], Root> = () => (tree) => {
  const processor = createJsxComponentProcessor("Steps", stepsToMarkdown);

  processor(tree);

  compactStepTree(tree);
  return tree;
};

export function stepsToMarkdown(node: MdxNode): Root["children"] {
  const items = processStepsNode(node);

  if (items.length === 0) {
    return [];
  }

  // Create ordered list - always spread for better readability
  const list = createOrderedList(items, 1, true);
  return [list];
}
