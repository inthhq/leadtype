import type { Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import {
  createJsxComponentProcessor,
  getAttributeValue,
  normalizeWhitespace,
} from "../libs";

const TARGET_AGENT = "agent";
const TARGET_HUMAN = "human";

function normalizeTarget(value: string | null): string {
  return normalizeWhitespace(value ?? "").toLowerCase();
}

export function remarkAudienceToMarkdown(): Transformer<Root, Root> {
  return createJsxComponentProcessor("Audience", (node) => {
    const target = normalizeTarget(getAttributeValue(node, "target"));

    if (target === TARGET_HUMAN) {
      return [];
    }

    if (target === TARGET_AGENT || target.length === 0) {
      return (node.children ?? []) as RootContent[];
    }

    return (node.children ?? []) as RootContent[];
  });
}
