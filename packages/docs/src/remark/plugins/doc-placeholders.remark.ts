import type { Definition, Image, Link, Root } from "mdast";
import type { MdxJsxAttribute } from "mdast-util-mdx-jsx";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import {
  deriveDocContext,
  resolveDocPlaceholders,
} from "../../internal/docs-context";

const URL_ATTRIBUTE_NAMES = new Set(["href", "to", "url"]);

function resolveUrlValue(value: string, sourcePath: string): string {
  const context = deriveDocContext(sourcePath);
  return resolveDocPlaceholders(value, context).value;
}

function rewriteJsxAttribute(
  attribute: MdxJsxAttribute,
  sourcePath: string
): void {
  if (!URL_ATTRIBUTE_NAMES.has(attribute.name)) {
    return;
  }

  if (typeof attribute.value !== "string") {
    return;
  }

  attribute.value = resolveUrlValue(attribute.value, sourcePath);
}

export const remarkResolveDocPlaceholders: Plugin<[], Root> =
  () => (tree, file) => {
    const sourcePath = String(file.path ?? "");

    visit(tree, "link", (node: Link) => {
      node.url = resolveUrlValue(node.url, sourcePath);
    });

    visit(tree, "definition", (node: Definition) => {
      node.url = resolveUrlValue(node.url, sourcePath);
    });

    visit(tree, "image", (node: Image) => {
      node.url = resolveUrlValue(node.url, sourcePath);
    });

    visit(tree, ["mdxJsxFlowElement", "mdxJsxTextElement"], (node) => {
      const attributes =
        "attributes" in node && Array.isArray(node.attributes)
          ? node.attributes
          : [];

      for (const attribute of attributes) {
        if (attribute.type === "mdxJsxAttribute") {
          rewriteJsxAttribute(attribute, sourcePath);
        }
      }
    });
  };
