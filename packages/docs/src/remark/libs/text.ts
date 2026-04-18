import type {
  Blockquote,
  Paragraph,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import type { MdxNode } from "./types";

// Common regex patterns
const MULTI_WHITESPACE = /\s+/g;
const HORIZONTAL_WHITESPACE = /[ \t]+/g;
const BOLD_HEADER = /^\s*\*\*(.+?)\*\*\s*$/s;
const BLOCKQUOTE_LINE = /^>\s?/;
/**
 * Normalize whitespace in a string
 * @param text - The text to normalize
 * @param preserveNewlines - If true, preserves newlines while cleaning horizontal whitespace
 */
export function normalizeWhitespace(
  text: string,
  preserveNewlines = false
): string {
  const pattern = preserveNewlines ? HORIZONTAL_WHITESPACE : MULTI_WHITESPACE;
  // String.prototype.trim handles both leading/trailing whitespace and
  // newlines; TRIM_WHITESPACE was redundant.
  return text.replace(pattern, " ").trim();
}

/**
 * Extract text content from MDX node children
 */
export function extractNodeText(children: MdxNode["children"]): string {
  const root: Root = {
    type: "root",
    children: (children as unknown as RootContent[]) ?? [],
  };
  return mdastToString(root);
}

// cleanText function removed - consolidated into normalizeWhitespace with preserveNewlines=true

/**
 * Extract and normalize text from MDX node children
 */
export function extractAndCleanNodeText(children: MdxNode["children"]): string {
  return normalizeWhitespace(extractNodeText(children), true);
}

/**
 * Extract text content from a paragraph node
 */
export function extractParagraphContent(node: Paragraph): string[] {
  const rawText = extractNodeText(node.children);
  if (!rawText.trim()) {
    return [];
  }
  const cleanedText = normalizeWhitespace(rawText, true);
  return [cleanedText];
}

/**
 * Extract markdown content from a table node
 */
export function extractTableContent(node: Table): string[] {
  const tableRows = node.children || [];
  if (tableRows.length === 0) {
    return [];
  }

  const renderRow = (row: TableRow): string =>
    (row.children || [])
      .map((cell: TableCell) => extractNodeText(cell.children || []).trim())
      .join("|");

  const rendered = tableRows.map((row) => renderRow(row as TableRow));
  return [rendered.join("\n")];
}

/**
 * Extract markdown content from a blockquote node
 */
export function extractBlockquoteContent(node: Blockquote): string[] {
  // Preserve paragraph boundaries: iterate children and emit one "> ..."
  // fragment per non-empty paragraph-like child so downstream code can
  // reconstruct multi-paragraph blockquotes.
  const children = node.children ?? [];
  const fragments: string[] = [];
  for (const child of children) {
    const text = extractNodeText(
      (child as { children?: unknown[] }).children as never
    ).trim();
    if (text) {
      fragments.push(`> ${text}`);
    }
  }
  if (fragments.length === 0) {
    const fallback = extractNodeText(children as never).trim();
    return fallback ? [`> ${fallback}`] : [];
  }
  return fragments;
}

/**
 * Create a blockquote from content text
 */
export function createBlockquoteFromContent(
  contentText: string
): Blockquote | null {
  if (!contentText.startsWith("> ")) {
    return null;
  }

  const lines = contentText.split("\n");
  const paragraphs = lines
    .filter((line) => line.trim()) // Remove empty lines
    .map((line) => {
      // Remove leading > and optional space
      const cleanLine = line.replace(BLOCKQUOTE_LINE, "");
      return {
        type: "paragraph",
        children: [{ type: "text", value: cleanLine }],
      };
    });

  return {
    type: "blockquote",
    children: paragraphs,
  } as Blockquote;
}
/**
 * Process content text and return appropriate AST node
 */
export function processContentText(
  contentText: string
): Paragraph | Table | Blockquote | null {
  // Try to create a table first
  const table = createTableFromContent(contentText);
  if (table) {
    return table;
  }

  // Try to create a blockquote
  const blockquote = createBlockquoteFromContent(contentText);
  if (blockquote) {
    return blockquote;
  }

  // Check for bold headers with regex to handle whitespace and inner asterisks
  const boldHeaderMatch = contentText.match(BOLD_HEADER);
  if (boldHeaderMatch?.[1]) {
    const headerText = boldHeaderMatch[1].trim();
    return {
      type: "paragraph",
      children: [
        { type: "strong", children: [{ type: "text", value: headerText }] },
      ],
    } as Paragraph;
  }

  // Skip empty content
  if (contentText.trim() === "") {
    return null;
  }

  // Regular paragraph content
  return {
    type: "paragraph",
    children: [{ type: "text", value: contentText }],
  } as Paragraph;
}

/**
 * Create a table from content text
 */
export function createTableFromContent(contentText: string): Table | null {
  if (!(contentText.includes("|") && contentText.includes("\n"))) {
    return null;
  }

  const lines = contentText
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return null;
  }

  // Strip leading/trailing pipe (and optional surrounding whitespace) so a
  // line like `| a | b |` doesn't produce empty boundary cells.
  const rows = lines.map((line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim())
  );

  return {
    type: "table",
    children: rows.map((row) => ({
      type: "tableRow",
      children: row.map((cell) => ({
        type: "tableCell",
        children: [{ type: "text", value: cell }],
      })),
    })),
  } as Table;
}
