/**
 * Markdown node builders for `defineComponentFlattener`.
 *
 * A thin, ergonomic layer over `libs/node-creators` so a `toMarkdown` function
 * can produce mdast without importing mdast types directly. Block-level
 * builders accept either a markdown string (parsed via `parseMarkdown`) or
 * existing nodes, so `b.blockquote([content])` and `b.blockquote(childNodes)`
 * are both valid.
 */

import type {
  BlockContent,
  Blockquote,
  Code,
  DefinitionContent,
  Emphasis,
  Heading,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
  Table,
  TableRow,
  Text,
} from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import {
  createHeading,
  createInlineCode,
  createLink,
  createOrderedList,
  createTable,
  createTableRow,
  createText,
} from "./libs";

type BlockChild = string | RootContent;
type BlockChildren = BlockChild | BlockChild[];
type InlineChildren = string | PhrasingContent[];

function createParseProcessor() {
  return remark().use(remarkMdx).use(remarkGfm);
}

let parseProcessor: ReturnType<typeof createParseProcessor> | null = null;

/**
 * Parse a markdown (incl. GFM) string into block-level mdast nodes. Used when a
 * builder receives a string where block content is expected.
 */
export function parseMarkdown(source: string): RootContent[] {
  if (!parseProcessor) {
    parseProcessor = createParseProcessor();
  }
  const tree = parseProcessor.runSync(
    parseProcessor.parse(source) as Root
  ) as Root;
  return tree.children;
}

function toBlockChildren(input: BlockChildren): RootContent[] {
  const items = Array.isArray(input) ? input : [input];
  const out: RootContent[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      out.push(...parseMarkdown(item));
    } else {
      out.push(item);
    }
  }
  return out;
}

function toInlineChildren(input: InlineChildren): PhrasingContent[] {
  return typeof input === "string" ? [createText(input)] : input;
}

export type Builders = {
  text: (value: string) => Text;
  strong: (content: InlineChildren) => Strong;
  em: (content: InlineChildren) => Emphasis;
  code: (value: string) => InlineCode;
  codeBlock: (value: string, lang?: string) => Code;
  paragraph: (content: InlineChildren) => Paragraph;
  heading: (depth: 1 | 2 | 3 | 4 | 5 | 6, content: InlineChildren) => Heading;
  link: (url: string, content: InlineChildren) => Link;
  list: (items: BlockChildren[]) => List;
  orderedList: (items: BlockChildren[], start?: number) => List;
  listItem: (content: BlockChildren) => ListItem;
  table: (
    headers: string[],
    rows: (string | PhrasingContent[])[][],
    align?: ("left" | "center" | "right" | null)[]
  ) => Table;
  tableRow: (cells: (string | PhrasingContent[])[]) => TableRow;
  blockquote: (content: BlockChildren) => Blockquote;
  /** Parse a markdown string into nodes (escape hatch / composition). */
  md: (source: string) => RootContent[];
};

function listItem(content: BlockChildren): ListItem {
  return {
    type: "listItem",
    spread: false,
    children: toBlockChildren(content) as (BlockContent | DefinitionContent)[],
  };
}

export const b: Builders = {
  text: createText,
  strong: (content) => ({
    type: "strong",
    children: toInlineChildren(content),
  }),
  em: (content) => ({ type: "emphasis", children: toInlineChildren(content) }),
  code: (value) => createInlineCode(value) as InlineCode,
  codeBlock: (value, lang) => ({ type: "code", lang: lang ?? null, value }),
  paragraph: (content) => ({
    type: "paragraph",
    children: toInlineChildren(content),
  }),
  heading: (depth, content) =>
    typeof content === "string"
      ? createHeading(depth, content)
      : { type: "heading", depth, children: content },
  link: (url, content) => createLink(url, content),
  list: (items) => ({
    type: "list",
    ordered: false,
    spread: false,
    children: items.map(listItem),
  }),
  orderedList: (items, start = 1) =>
    createOrderedList(items.map(listItem), start, false),
  listItem,
  table: createTable,
  tableRow: createTableRow,
  blockquote: (content) => ({
    type: "blockquote",
    children: toBlockChildren(content) as Blockquote["children"],
  }),
  md: parseMarkdown,
};
