import type { Code, Root } from "mdast";
import type { Transformer } from "unified";
import {
  createJsxComponentProcessor,
  getAttributeValue,
  hasName,
  type MdxNode,
  normalizeWhitespace,
} from "../libs";

type TreeEntry = {
  children: TreeEntry[];
  name: string;
  type: "file" | "folder";
};

function childrenOf(node: unknown): unknown[] {
  if (typeof node !== "object" || node === null || !("children" in node)) {
    return [];
  }

  const children = (node as { children?: unknown }).children;
  return Array.isArray(children) ? children : [];
}

function createEntry(node: MdxNode): TreeEntry | null {
  const name = normalizeWhitespace(getAttributeValue(node, "name") ?? "");
  if (!name) {
    return null;
  }

  if (hasName(node, "File")) {
    return { children: [], name, type: "file" };
  }

  if (hasName(node, "Folder")) {
    return {
      children: collectEntries(childrenOf(node)),
      name,
      type: "folder",
    };
  }

  return null;
}

function collectEntries(nodes: readonly unknown[]): TreeEntry[] {
  const entries: TreeEntry[] = [];

  for (const child of nodes) {
    if (hasName(child, "File") || hasName(child, "Folder")) {
      const entry = createEntry(child as MdxNode);
      if (entry) {
        entries.push(entry);
      }
      continue;
    }

    entries.push(...collectEntries(childrenOf(child)));
  }

  return entries;
}

function renderEntry(
  entry: TreeEntry,
  prefix: string,
  isLast: boolean
): string[] {
  const connector = isLast ? "└── " : "├── ";
  const suffix = entry.type === "folder" ? "/" : "";
  const lines = [`${prefix}${connector}${entry.name}${suffix}`];
  const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;

  for (const [index, child] of entry.children.entries()) {
    lines.push(
      ...renderEntry(child, childPrefix, index === entry.children.length - 1)
    );
  }

  return lines;
}

function renderTree(entries: TreeEntry[], rootName: string): string {
  const lines = rootName ? [`${rootName.replace(/\/+$/, "")}/`] : [];

  for (const [index, entry] of entries.entries()) {
    lines.push(...renderEntry(entry, "", index === entries.length - 1));
  }

  return lines.join("\n");
}

function createCodeBlock(value: string): Code {
  return {
    type: "code",
    lang: "text",
    value,
  };
}

export function remarkFileTreeToMarkdown(): Transformer<Root, Root> {
  return createJsxComponentProcessor("FileTree", (node) => {
    const entries = collectEntries(node.children ?? []);
    const rootName = normalizeWhitespace(getAttributeValue(node, "root") ?? "");

    if (entries.length === 0 && !rootName) {
      return [];
    }

    return [createCodeBlock(renderTree(entries, rootName))];
  });
}
