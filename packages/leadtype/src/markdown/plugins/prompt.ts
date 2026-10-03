import type { Code, Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import {
  createJsxComponentProcessor,
  createParagraph,
  createStrongParagraph,
  getAttributeValue,
  type MdxNode,
  normalizeWhitespace,
} from "../libs";
import { stringifyMarkdown } from "../stringify";

function createCodeBlock(value: string): Code {
  return {
    type: "code",
    lang: "prompt",
    value,
  };
}

function childrenToMarkdown(children: readonly RootContent[]): string {
  return stringifyMarkdown(
    { type: "root", children: [...children] },
    { bullet: "-" }
  ).trim();
}

export function remarkPromptToMarkdown(): Transformer<Root, Root> {
  return createJsxComponentProcessor("Prompt", promptToMarkdown);
}

export function promptToMarkdown(node: MdxNode): RootContent[] {
  const title = normalizeWhitespace(getAttributeValue(node, "title") ?? "");
  const description = normalizeWhitespace(
    getAttributeValue(node, "description") ?? ""
  );
  const body = childrenToMarkdown((node.children ?? []) as RootContent[]);
  const replacement: RootContent[] = [];

  if (title) {
    replacement.push(createStrongParagraph(title));
  }

  if (description) {
    replacement.push(createParagraph(description));
  }

  if (body) {
    replacement.push(createCodeBlock(body));
  }

  return replacement;
}
