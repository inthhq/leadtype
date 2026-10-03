import type {
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import type { Transformer } from "unified";
import { SKIP, visit } from "unist-util-visit";
import {
  extractNodeText,
  getAttributeValue,
  hasName,
  type MdxNode,
  normalizeWhitespace,
} from "../libs";

/**
 * Types
 */
type CardsToMarkdownOptions = {
  /** When true, append a plain-text description after the link. */
  withDescriptions?: boolean;
};

type LinkItem = {
  href: string;
  text: string;
  description?: string;
};

function createLinkItem(node: MdxNode): LinkItem | null {
  const href = normalizeWhitespace(getAttributeValue(node, "href") ?? "");
  if (!href) {
    return null;
  }

  const titleAttr = normalizeWhitespace(getAttributeValue(node, "title") ?? "");
  const text = titleAttr || extractNodeText(node.children);
  if (!text) {
    return null;
  }

  const description =
    normalizeWhitespace(getAttributeValue(node, "description") ?? "") ||
    undefined;

  return { href, text, description };
}

function collectLinksFromParagraph(paragraph: {
  children?: unknown[];
}): LinkItem[] {
  const results: LinkItem[] = [];
  if (!paragraph.children) {
    return results;
  }

  for (const child of paragraph.children) {
    if (hasName(child, "Card")) {
      const linkItem = createLinkItem(child);
      if (linkItem) {
        results.push(linkItem);
      }
    }
  }
  return results;
}

function collectLinksFromContainer(container: MdxNode): LinkItem[] {
  const results: LinkItem[] = [];

  // Iterate only over immediate children to preserve deterministic ordering
  if (!container.children) {
    return results;
  }

  for (const child of container.children) {
    if (child.type === "paragraph") {
      results.push(...collectLinksFromParagraph(child));
    } else if (hasName(child, "Card")) {
      const linkItem = createLinkItem(child);
      if (linkItem) {
        results.push(linkItem);
      }
    }
  }

  return results;
}

function toListItem(item: LinkItem, withDescriptions: boolean): ListItem {
  const linkNode: Link = {
    type: "link",
    url: item.href,
    children: [{ type: "text", value: item.text }],
  };

  const phrasing: PhrasingContent[] = [linkNode];
  if (withDescriptions && item.description) {
    phrasing.push({ type: "text", value: ` — ${item.description}` });
  }

  const para: Paragraph = { type: "paragraph", children: phrasing };

  return {
    type: "listItem",
    spread: false,
    children: [para],
  };
}

export function remarkCardsToMarkdown(
  options: CardsToMarkdownOptions = {}
): Transformer<Root, Root> {
  const { withDescriptions = false } = options;

  return (tree: Root): void => {
    visit(
      tree,
      ["mdxJsxFlowElement", "mdxJsxTextElement"],
      (node, index, parent) => {
        if (typeof index !== "number" || !parent) {
          return;
        }
        // Only support the new Cards container
        if (!hasName(node, "Cards")) {
          return;
        }

        const result = cardsToMarkdown(node, { withDescriptions });
        if (result.length === 0) {
          parent.children.splice(index, 1);
          return [SKIP, index];
        }
        parent.children.splice(index, 1, ...result);
        return [SKIP, index];
      }
    );
  };
}

export function cardsToMarkdown(
  node: MdxNode,
  options: CardsToMarkdownOptions = {}
): RootContent[] {
  const { withDescriptions = false } = options;
  const links = collectLinksFromContainer(node);
  if (links.length === 0) {
    return [];
  }

  const list: List = {
    type: "list",
    ordered: false,
    spread: false,
    children: links.map((l) => toListItem(l, withDescriptions)),
  };

  return [list];
}
