import JSON5 from "json5";
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
  const linkNode: Link = {
    type: "link",
    url: href,
    children: [{ type: "text", value: item.label }],
  };
  const children: PhrasingContent[] = [linkNode];

  if (withDescriptions && item.description) {
    children.push({ type: "text", value: ` — ${item.description}` });
  }

  const paragraph: Paragraph = { type: "paragraph", children };

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

        const result = topicSwitcherToMarkdown(node as MdxNode, sourcePath);
        if (result.length === 0) {
          parent.children.splice(index, 1);
          return [SKIP, index];
        }
        parent.children.splice(index, 1, ...result);
        return SKIP;
      }
    );

    return tree;
  };
}

export function topicSwitcherToMarkdown(
  node: MdxNode,
  sourcePath: string
): RootContent[] {
  const items = parseItems(getAttributeValue(node, "items"));

  if (items.length === 0) {
    return [];
  }

  const label = normalizeWhitespace(
    getAttributeValue(node, "label") ?? "Topics"
  );
  const list: List = {
    type: "list",
    ordered: false,
    spread: false,
    children: items.map((item) => itemToListItem(item, true, sourcePath)),
  };

  return [createParagraph(label), list];
}
