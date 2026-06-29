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

import type { Paragraph, Root, RootContent } from "mdast";
import type { MdxJsxFlowElement } from "mdast-util-mdx";
import type { VFile } from "vfile";
import { createText, getAttributeValue, hasName, type MdxNode } from "../libs";
import {
  createTypeTableExtractionFailureMessage,
  extractTypeFromFile,
  resolveDefaultTypeTableBasePath,
} from "./type-table.remark";

export type RemarkResolveTypeTableJsxOptions = {
  /** Base directory used to resolve relative `path=` attributes. */
  basePath?: string;
  /** Throw when extraction fails instead of emitting a visible warning node. */
  strict?: boolean;
  /** Emit a visible warning node when extraction fails. Defaults to true. */
  warnOnFailure?: boolean;
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

function getVFilePath(file?: VFile): string | undefined {
  return typeof file?.path === "string" && file.path.length > 0
    ? file.path
    : undefined;
}

function createWarningParagraph(message: string): Paragraph {
  return {
    type: "paragraph",
    children: [
      { type: "strong", children: [createText("Warning:")] },
      createText(` ${message}`),
    ],
  };
}

export function remarkResolveTypeTableJsx(
  options: RemarkResolveTypeTableJsxOptions = {}
): (tree: Root, file?: VFile) => Root {
  return (tree: Root, file?: VFile): Root => {
    const basePath =
      options.basePath ?? resolveDefaultTypeTableBasePath(getVFilePath(file));
    const replace = (
      parentChildren: Root["children"],
      index: number,
      replacement: RootContent | RootContent[]
    ) => {
      const replacements = Array.isArray(replacement)
        ? replacement
        : [replacement];
      parentChildren.splice(
        index,
        1,
        ...(replacements as unknown as Root["children"])
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
          // implement one runtime component. If extraction fails, emit a
          // visible warning before the placeholder table unless strict mode
          // has been enabled.
          const extracted = extractTypeFromFile(path, name, overrideBasePath);
          const typeTableNode = buildTypeTableNode({
            properties: extracted ?? {},
            title,
            description,
            name,
            path,
          });
          if (!extracted) {
            const message = createTypeTableExtractionFailureMessage({
              basePath: overrideBasePath,
              path,
              typeName: name,
            });
            if (options.strict) {
              throw new Error(message);
            }
            if (options.warnOnFailure ?? true) {
              replace(parentChildren, index, [
                createWarningParagraph(message),
                typeTableNode as unknown as RootContent,
              ]);
              continue;
            }
          }
          replace(
            parentChildren,
            index,
            typeTableNode as unknown as RootContent
          );
          continue;
        }

        if (node.children && Array.isArray(node.children)) {
          visitChildren(node.children);
        }
      }
    };

    // Some MDX pipelines (e.g. Next's loader) can invoke the transformer with a
    // root that has no `children`; guard so the plugin no-ops instead of throwing.
    if (Array.isArray(tree.children)) {
      visitChildren(tree.children);
    }
    return tree;
  };
}
