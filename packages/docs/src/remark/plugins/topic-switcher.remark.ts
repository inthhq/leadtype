import JSON5 from "json5";
import type {
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
} from "mdast";
import type { Transformer } from "unified";
import { u } from "unist-builder";
import { SKIP, visit } from "unist-util-visit";
import {
  deriveDocContext,
  resolveDocPlaceholders,
} from "../../internal/docs-context";
import {
  createParagraph,
  getAttributeValue,
  hasName,
  type MdxNode,
  normalizeWhitespace,
} from "../libs";

type TopicItem = {
  value: string;
  label: string;
  href: string;
  description?: string;
};

function isTopicItem(value: unknown): value is TopicItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const hasRequiredKeys =
    "value" in value && "label" in value && "href" in value;
  if (!hasRequiredKeys) {
    return false;
  }

  return (
    typeof value.value === "string" &&
    typeof value.label === "string" &&
    typeof value.href === "string"
  );
}

function parseItems(raw: string | null): TopicItem[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON5.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isTopicItem).map((item) => ({
      value: item.value,
      label: item.label,
      href: item.href,
      description:
        typeof item.description === "string" ? item.description : undefined,
    }));
  } catch {
    return [];
  }
}

function itemToListItem(
  item: TopicItem,
  withDescriptions: boolean,
  sourcePath: string
): ListItem {
  const context = deriveDocContext(sourcePath);
  const href = resolveDocPlaceholders(item.href, context).value;
  const linkNode: Link = u("link", { url: href }, [
    u("text", item.label),
  ]) as Link;
  const children: PhrasingContent[] = [linkNode];

  if (withDescriptions && item.description) {
    children.push(u("text", ` — ${item.description}`) as PhrasingContent);
  }

  const paragraph: Paragraph = u("paragraph", children) as Paragraph;

  return {
    type: "listItem",
    spread: false,
    children: [paragraph],
  };
}

export function remarkTopicSwitcherToMarkdown(): Transformer<Root, Root> {
  return (tree, file): Root => {
    const sourcePath = String(file.path ?? "");

    visit(
      tree,
      ["mdxJsxFlowElement", "mdxJsxTextElement"],
      (node, index, parent) => {
        if (
          !parent ||
          typeof index !== "number" ||
          !hasName(node, "TopicSwitcher")
        ) {
          return;
        }

        const mdxNode = node as MdxNode;
        const items = parseItems(getAttributeValue(mdxNode, "items"));

        if (items.length === 0) {
          parent.children.splice(index, 1);
          return [SKIP, index];
        }

        const label = normalizeWhitespace(
          getAttributeValue(mdxNode, "label") ?? "Topics"
        );
        const list: List = {
          type: "list",
          ordered: false,
          spread: false,
          children: items.map((item) => itemToListItem(item, true, sourcePath)),
        };

        parent.children.splice(index, 1, createParagraph(label), list);
        return SKIP;
      }
    );

    return tree;
  };
}
