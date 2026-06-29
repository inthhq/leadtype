import type {
  BlockContent,
  Blockquote,
  Break,
  Code,
  Definition,
  Delete,
  Emphasis,
  Heading,
  Html,
  Image,
  InlineCode,
  Link,
  LinkReference,
  List,
  ListItem,
  Paragraph,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
  ThematicBreak,
} from "mdast";

type MdastNode = Root | RootContent | PhrasingContent | TableCell | TableRow;

export type StringifyMarkdownOptions = {
  bullet?: "-" | "*";
};

type StringifyState = {
  bullet: "-" | "*";
};

type MdastValueNode = {
  value?: unknown;
};

type MdxJsxAttribute = {
  type?: string;
  name?: string;
  value?: unknown;
};

type MdxJsxNode = Parent & {
  attributes?: MdxJsxAttribute[];
  name?: string | null;
};

const BACKTICK_REGEX = /`+/g;
const TABLE_PIPE_REGEX = /\|/g;
const LINE_BREAK_REGEX = /\r?\n/g;

function repeat(value: string, count: number): string {
  return Array.from({ length: count }, () => value).join("");
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n (?=\S)/g, "\n&#x20;")
    .replace(/(^|\n)(&#x20;)?>(?=\n|$)/g, "$1$2\\>")
    .replace(/'([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)'/g, "'$1\\.$2'")
    .replace(/(^|\n)(\d+)\. /g, "$1$2\\. ")
    .replace(/`/g, "\\`")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\~")
    .replace(/\[/g, "\\[")
    .replace(/\{/g, "\\{")
    .replace(/:\/\//g, "\\://")
    .replace(/</g, "\\<");
}

function escapeTableText(value: string): string {
  return value
    .replace(/(?<=\w)&(?=\w)/g, "\\&")
    .replace(TABLE_PIPE_REGEX, "\\|")
    .replace(LINE_BREAK_REGEX, " ");
}

function fenceFor(value: string): string {
  const longest = Math.max(
    0,
    ...Array.from(value.matchAll(BACKTICK_REGEX), (match) => match[0].length)
  );
  return repeat("`", Math.max(3, longest + 1));
}

function inlineCode(value: string): string {
  const content = value.replace(/\s*\n\s*/g, " ");
  const longest = Math.max(
    0,
    ...Array.from(content.matchAll(BACKTICK_REGEX), (match) => match[0].length)
  );
  const delimiter = repeat("`", longest + 1);
  const needsPadding =
    content.includes("`") ||
    content.startsWith("`") ||
    content.endsWith("`") ||
    content.trim() !== content;
  const padding = needsPadding ? " " : "";
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}

function indentLines(value: string, prefix: string): string {
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? `${prefix}${line}` : prefix.trimEnd()))
    .join("\n");
}

function hasChildren(node: unknown): node is Parent {
  return (
    typeof node === "object" &&
    node !== null &&
    "children" in node &&
    Array.isArray((node as Parent).children)
  );
}

function stringifyInlineNodes(
  nodes: readonly PhrasingContent[],
  state: StringifyState
): string {
  return nodes.map((node) => stringifyInline(node, state)).join("");
}

function stringifyInline(
  node: PhrasingContent | TableCell,
  state: StringifyState
): string {
  switch (node.type) {
    case "text":
      return escapeText((node as Text).value);
    case "strong": {
      const content = stringifyInlineNodes(
        (node as Strong).children,
        state
      ).replace(/(^|\n)(\d+)\\\. /g, "$1$2. ");
      return `**${content}**`;
    }
    case "emphasis":
      return `*${stringifyInlineNodes((node as Emphasis).children, state)}*`;
    case "delete":
      return `~~${stringifyInlineNodes((node as Delete).children, state)}~~`;
    case "inlineCode":
      return inlineCode((node as InlineCode).value);
    case "link": {
      const link = node as Link;
      const title = link.title ? ` "${link.title.replace(/"/g, '\\"')}"` : "";
      const label = stringifyInlineNodes(link.children, state).replace(
        /\\:\/\//g,
        "://"
      );
      return `[${label}](${link.url}${title})`;
    }
    case "linkReference": {
      const link = node as LinkReference;
      const identifier = link.label ?? link.identifier;
      return `[${stringifyInlineNodes(link.children, state)}][${identifier}]`;
    }
    case "image": {
      const image = node as Image;
      const title = image.title ? ` "${image.title.replace(/"/g, '\\"')}"` : "";
      return `![${image.alt ?? ""}](${image.url}${title})`;
    }
    case "break":
      return "\\\n";
    case "html":
      return (node as Html).value;
    case "tableCell":
      return stringifyInlineNodes((node as TableCell).children, state);
    default:
      return stringifyMdxFallback(node, state);
  }
}

function stringifyParagraph(
  paragraph: Paragraph,
  state: StringifyState
): string {
  return stringifyInlineNodes(paragraph.children, state);
}

function stringifyHeading(heading: Heading, state: StringifyState): string {
  const text = stringifyInlineNodes(heading.children, state).replace(
    /(^|\n)(\d+)\\\. /g,
    "$1$2. "
  );
  return `${repeat("#", heading.depth)} ${text}`;
}

function stringifyCode(code: Code): string {
  const fence = fenceFor(code.value);
  const info = [code.lang, code.meta].filter(Boolean).join(" ");
  return `${fence}${info}\n${code.value}\n${fence}`;
}

function stringifyBlockquote(
  blockquote: Blockquote,
  state: StringifyState
): string {
  return indentLines(stringifyBlocks(blockquote.children, state), "> ");
}

function listItemPrefix(
  list: List,
  index: number,
  state: StringifyState
): string {
  if (!list.ordered) {
    return `${state.bullet} `;
  }
  const start = list.start ?? 1;
  return `${start + index}. `;
}

function stringifyListItem(
  item: ListItem,
  list: List,
  index: number,
  state: StringifyState
): string {
  const prefix = listItemPrefix(list, index, state);
  const taskMarker =
    typeof item.checked === "boolean" ? `[${item.checked ? "x" : " "}] ` : "";
  const body = stringifyListItemBlocks(item.children as BlockContent[], state);
  const lines = body.split("\n");
  const first = lines.shift() ?? "";
  const padding = repeat(" ", prefix.length);
  const rest = lines
    .map((line) => (line.length > 0 ? `${padding}${line}` : ""))
    .join("\n");
  return rest
    ? `${prefix}${taskMarker}${first}\n${rest}`
    : `${prefix}${taskMarker}${first}`;
}

function stringifyListItemBlocks(
  nodes: readonly BlockContent[],
  state: StringifyState
): string {
  return nodes
    .map((node) => stringifyNode(node as MdastNode, state).trimEnd())
    .filter((value) => value.length > 0)
    .reduce<string[]>((parts, value, index, values) => {
      parts.push(value);
      if (index < values.length - 1) {
        const current = nodes[index];
        const next = nodes[index + 1] as BlockContent | undefined;
        const currentEndLine = current?.position?.end.line;
        const nextStartLine = next?.position?.start.line;
        const isAdjacentInSource =
          typeof currentEndLine === "number" &&
          typeof nextStartLine === "number" &&
          nextStartLine - currentEndLine <= 1;
        const compactNestedList =
          current?.type === "paragraph" &&
          next?.type === "list" &&
          !(next as List).ordered &&
          !(next as List).spread &&
          isAdjacentInSource;
        parts.push(compactNestedList ? "\n" : "\n\n");
      }
      return parts;
    }, [])
    .join("");
}

function stringifyList(list: List, state: StringifyState): string {
  const separator = list.spread ? "\n\n" : "\n";
  return list.children
    .map((item, index) => stringifyListItem(item, list, index, state))
    .join(separator);
}

function tableCellText(
  cell: TableCell | undefined,
  state: StringifyState
): string {
  if (!cell) {
    return "";
  }
  return escapeTableText(stringifyInline(cell, state));
}

function tableDivider(
  align: Table["align"] | undefined,
  index: number
): string {
  switch (align?.[index]) {
    case "left":
      return ":---";
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

function stringifyTable(table: Table, state: StringifyState): string {
  const [header, ...rows] = table.children;
  const columnCount = Math.max(
    header?.children.length ?? 0,
    ...rows.map((row) => row.children.length)
  );
  const headerCells = Array.from({ length: columnCount }, (_, index) =>
    tableCellText(header?.children[index], state)
  );
  const divider = Array.from({ length: columnCount }, (_, index) =>
    tableDivider(table.align, index)
  );
  const body = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) =>
      tableCellText(row.children[index], state)
    )
  );
  return [headerCells, divider, ...body]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function stringifyThematicBreak(_node: ThematicBreak): string {
  return "***";
}

function stringifyDefinition(definition: Definition): string {
  const title = definition.title
    ? ` "${definition.title.replace(/"/g, '\\"')}"`
    : "";
  return `[${definition.label ?? definition.identifier}]: ${definition.url}${title}`;
}

function stringifyMdxAttribute(attribute: MdxJsxAttribute): string {
  if (attribute.type !== "mdxJsxAttribute" || !attribute.name) {
    return "";
  }
  if (attribute.value === null || attribute.value === undefined) {
    return attribute.name;
  }
  if (typeof attribute.value === "string") {
    return `${attribute.name}="${attribute.value.replace(/"/g, "&quot;")}"`;
  }
  if (
    typeof attribute.value === "object" &&
    "value" in attribute.value &&
    typeof (attribute.value as MdastValueNode).value === "string"
  ) {
    return `${attribute.name}={${(attribute.value as MdastValueNode).value}}`;
  }
  return attribute.name;
}

function stringifyMdxFallback(node: unknown, state: StringifyState): string {
  if (
    typeof node !== "object" ||
    node === null ||
    !("type" in node) ||
    typeof node.type !== "string"
  ) {
    return "";
  }
  if ("value" in node && typeof (node as MdastValueNode).value === "string") {
    return String((node as MdastValueNode).value);
  }
  if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
    const jsx = node as MdxJsxNode;
    const name = jsx.name ?? "";
    const attrs = (jsx.attributes ?? [])
      .map(stringifyMdxAttribute)
      .filter(Boolean)
      .join(" ");
    const open = attrs ? `<${name} ${attrs}>` : `<${name}>`;
    const selfClosing = attrs ? `<${name} ${attrs} />` : `<${name} />`;
    if (node.type === "mdxJsxTextElement") {
      const children = hasChildren(jsx)
        ? jsx.children
            .map((child) => stringifyInline(child as PhrasingContent, state))
            .join("")
        : "";
      return children ? `${open}${children}</${name}>` : selfClosing;
    }
    const children = hasChildren(jsx)
      ? jsx.children
          .map((child) => stringifyNode(child as MdastNode, state))
          .filter(Boolean)
          .join("\n\n")
      : "";
    return children ? `${open}\n${children}\n</${name}>` : selfClosing;
  }
  if (hasChildren(node)) {
    return node.children
      .map((child) => stringifyNode(child as MdastNode, state))
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

function stringifyNode(node: MdastNode, state: StringifyState): string {
  switch (node.type) {
    case "root":
      return stringifyBlocks((node as Root).children, state);
    case "paragraph":
      return stringifyParagraph(node as Paragraph, state);
    case "heading":
      return stringifyHeading(node as Heading, state);
    case "code":
      return stringifyCode(node as Code);
    case "blockquote":
      return stringifyBlockquote(node as Blockquote, state);
    case "list":
      return stringifyList(node as List, state);
    case "table":
      return stringifyTable(node as Table, state);
    case "thematicBreak":
      return stringifyThematicBreak(node as ThematicBreak);
    case "definition":
      return stringifyDefinition(node as Definition);
    case "html":
      return (node as Html).value;
    case "break":
      return (node as Break).type === "break" ? "\\\n" : "";
    default:
      return stringifyInline(node as PhrasingContent, state);
  }
}

function stringifyBlocks(
  nodes: readonly RootContent[] | readonly BlockContent[],
  state: StringifyState
): string {
  return nodes
    .map((node) => stringifyNode(node as MdastNode, state).trimEnd())
    .filter((value) => value.length > 0)
    .join("\n\n");
}

export function stringifyMarkdown(
  root: Root,
  options: StringifyMarkdownOptions = {}
): string {
  const markdown = stringifyBlocks(root.children, {
    bullet: options.bullet ?? "*",
  });
  return markdown ? `${markdown}\n` : "";
}
