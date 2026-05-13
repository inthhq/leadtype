/**
 * Remark plugin that resolves `<ExtractedTypeTable name="X" path="..." />`
 * (and its `<AutoTypeTable>` alias) into `<TypeTable properties={{...}} />`
 * MDX JSX nodes at build time.
 *
 * Companion to `remarkTypeTableToMarkdown` (which flattens to a markdown
 * table for the agent/LLM pipeline). This variant keeps the node as JSX
 * so the consumer's runtime `<TypeTable>` component receives the resolved
 * `properties` prop directly — no markdown table baked in.
 *
 * Use this in the `mdxSourcePlugins` preset shipped from `leadtype/mdx`.
 */

import { resolve } from "node:path";
import type { Root } from "mdast";
import type { MdxJsxFlowElement } from "mdast-util-mdx";
import { getAttributeValue, hasName, type MdxNode } from "../libs";
import { extractTypeFromFile } from "./type-table.remark";

const DEFAULT_EXTRACTED_TYPE_BASE_PATH = "docs";

export type RemarkResolveTypeTableJsxOptions = {
  /** Base directory used to resolve relative `path=` attributes. */
  basePath?: string;
};

type AttrValueExpression = {
  type: "mdxJsxAttributeValueExpression";
  value: string;
};

type JsxAttribute = {
  type: "mdxJsxAttribute";
  name: string;
  value: string | AttrValueExpression | null;
};

function stringAttribute(name: string, value: string): JsxAttribute {
  return { type: "mdxJsxAttribute", name, value };
}

function expressionAttribute(name: string, expression: string): JsxAttribute {
  return {
    type: "mdxJsxAttribute",
    name,
    value: { type: "mdxJsxAttributeValueExpression", value: expression },
  };
}

function isExtractedTypeTableNode(node: MdxNode): boolean {
  return hasName(node, "ExtractedTypeTable") || hasName(node, "AutoTypeTable");
}

function buildTypeTableNode(opts: {
  properties: Record<string, unknown>;
  title?: string;
  description?: string;
  name?: string;
  path?: string;
}): MdxJsxFlowElement {
  const attributes: JsxAttribute[] = [
    expressionAttribute("properties", JSON.stringify(opts.properties)),
  ];
  if (opts.title) {
    attributes.push(stringAttribute("title", opts.title));
  }
  if (opts.description) {
    attributes.push(stringAttribute("description", opts.description));
  }
  if (opts.name) {
    attributes.push(stringAttribute("name", opts.name));
  }
  if (opts.path) {
    attributes.push(stringAttribute("path", opts.path));
  }
  return {
    type: "mdxJsxFlowElement",
    name: "TypeTable",
    attributes: attributes as MdxJsxFlowElement["attributes"],
    children: [],
  };
}

export function remarkResolveTypeTableJsx(
  options: RemarkResolveTypeTableJsxOptions = {}
): (tree: Root) => Root {
  const defaultBasePath = resolve(
    process.cwd(),
    DEFAULT_EXTRACTED_TYPE_BASE_PATH
  );
  const basePath = options.basePath ?? defaultBasePath;

  return (tree: Root): Root => {
    const replace = (
      parentChildren: Root["children"],
      index: number,
      replacement: MdxJsxFlowElement
    ) => {
      parentChildren.splice(
        index,
        1,
        replacement as unknown as Root["children"][number]
      );
    };

    const visitChildren = (parentChildren: Root["children"]): void => {
      for (let index = 0; index < parentChildren.length; index += 1) {
        const child = parentChildren[index] as MdxNode | undefined;
        if (!child) {
          continue;
        }

        const node = child as unknown as {
          type?: string;
          children?: Root["children"];
        };

        if (
          child &&
          (child.type === "mdxJsxFlowElement" ||
            child.type === "mdxJsxTextElement") &&
          isExtractedTypeTableNode(child)
        ) {
          const name = getAttributeValue(child, "name");
          const path = getAttributeValue(child, "path");
          const title = getAttributeValue(child, "title") ?? undefined;
          const description =
            getAttributeValue(child, "description") ?? undefined;
          const overrideBasePath =
            getAttributeValue(child, "basePath") ?? basePath;

          if (!(name && path)) {
            continue;
          }

          // Always rewrite the tag to `<TypeTable>` so consumers only ever
          // implement one runtime component. If extraction failed, `properties`
          // is `{}` and `name`/`path` are still passed through — the consumer's
          // TypeTable can render a placeholder for that case.
          const extracted = extractTypeFromFile(path, name, overrideBasePath);
          replace(
            parentChildren,
            index,
            buildTypeTableNode({
              properties: extracted ?? {},
              title,
              description,
              name,
              path,
            })
          );
          continue;
        }

        if (node.children && Array.isArray(node.children)) {
          visitChildren(node.children);
        }
      }
    };

    visitChildren(tree.children);
    return tree;
  };
}
