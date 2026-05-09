import type { Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import {
  createJsxComponentProcessor,
  createStrongParagraph,
  getAttributeValue,
  hasName,
  type MdxNode,
  normalizeWhitespace,
  processContentNode,
} from "../libs";

function processItemContent(children: RootContent[]): RootContent[] {
  const result: RootContent[] = [];

  for (const child of children) {
    const processed = processContentNode(child);
    if (processed) {
      result.push(processed as RootContent);
    }
  }

  return result;
}

function collectAccordionItems(node: MdxNode): MdxNode[] {
  const children = (node.children ?? []) as RootContent[];
  const items: MdxNode[] = [];

  for (const child of children) {
    if (hasName(child, "AccordionItem")) {
      items.push(child as MdxNode);
      continue;
    }

    if (child.type !== "paragraph") {
      continue;
    }

    const paragraphChildren =
      (child as { children?: RootContent[] }).children ?? [];
    for (const paragraphChild of paragraphChildren) {
      if (hasName(paragraphChild, "AccordionItem")) {
        items.push(paragraphChild as MdxNode);
      }
    }
  }

  return items;
}

function fallbackTitle(item: MdxNode, index: number): string {
  const explicit = normalizeWhitespace(getAttributeValue(item, "title") ?? "");
  return explicit || `Item ${index + 1}`;
}

function itemToMarkdown(item: MdxNode, index: number): RootContent[] {
  const title = fallbackTitle(item, index);
  const children = (item.children ?? []) as RootContent[];
  const processedChildren = processItemContent(children);

  if (processedChildren.length === 0) {
    return [createStrongParagraph(title)];
  }

  return [createStrongParagraph(title), ...processedChildren];
}

export function remarkAccordionToMarkdown(): Transformer<Root, Root> {
  return createJsxComponentProcessor("Accordion", (node) => {
    const items = collectAccordionItems(node);

    if (items.length === 0) {
      return [];
    }

    return items.flatMap(itemToMarkdown);
  });
}
