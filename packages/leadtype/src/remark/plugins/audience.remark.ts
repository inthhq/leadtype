import type { Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import {
  createJsxComponentProcessor,
  getAttributeValue,
  normalizeWhitespace,
} from "../libs";

const TARGET_HUMAN = "human";

function unwrapStringLiteralExpression(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed.at(0);

  if (
    quote &&
    (quote === '"' || quote === "'" || quote === "`") &&
    trimmed.endsWith(quote)
  ) {
    return trimmed.slice(1, -1);
  }

  return value;
}

function normalizeTarget(value: string | null): string {
  return normalizeWhitespace(
    unwrapStringLiteralExpression(value ?? "")
  ).toLowerCase();
}

export function remarkAudienceToMarkdown(): Transformer<Root, Root> {
  return createJsxComponentProcessor("Audience", (node) => {
    const target = normalizeTarget(getAttributeValue(node, "target"));

    if (target === TARGET_HUMAN) {
      return [];
    }

    return (node.children ?? []) as RootContent[];
  });
}
