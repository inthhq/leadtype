import type { Code, Root, RootContent } from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import type { Transformer } from "unified";
import {
  createJsxComponentProcessor,
  createParagraph,
  createStrongParagraph,
  getAttributeValue,
  normalizeWhitespace,
} from "../libs";

const stringifier = remark().use(remarkGfm).data("settings", {
  bullet: "-",
  emphasis: "_",
  fence: "`",
  fences: true,
  listItemIndent: "one",
  rule: "-",
});

function createCodeBlock(value: string): Code {
  return {
    type: "code",
    lang: "prompt",
    value,
  };
}

function childrenToMarkdown(children: readonly RootContent[]): string {
  return stringifier
    .stringify({ type: "root", children: [...children] })
    .trim();
}

export function remarkPromptToMarkdown(): Transformer<Root, Root> {
  return createJsxComponentProcessor("Prompt", (node) => {
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
  });
}
