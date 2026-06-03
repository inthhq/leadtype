import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const MERMAID_CODE_CLASS = "language-mermaid";
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/g;
const NON_WORD_KEEP_SPACE_PATTERN = /[^\w\s-]/g;
const EDGE_HYPHENS_PATTERN = /^-|-$/g;
const WHITESPACE_PATTERN = /\s+/g;
const MERMAID_NODE_PATTERN = /^([A-Za-z_][\w-]*)\["([\s\S]+)"\]$/;
const MERMAID_EDGE_PATTERN = /^([A-Za-z_][\w-]*)\s*-->\s*([A-Za-z_][\w-]*)$/;
const SVG_NODE_WIDTH = 154;
const SVG_NODE_HEIGHT = 56;
const SVG_COLUMN_GAP = 178;
const SVG_ROW_GAP = 82;
const SVG_PADDING_X = 44;
const SVG_PADDING_Y = 34;

interface HastNode {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type?: string;
  value?: string;
}

interface RenderMarkdownOptions {
  headingIds?: readonly string[];
}

interface MermaidDiagram {
  edges: { from: string; to: string }[];
  nodes: Map<string, string>;
}

interface MermaidLayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

function addCanonicalHeadingIds(headingIds: readonly string[] = []) {
  return (tree: HastNode) => {
    if (headingIds.length === 0) {
      return;
    }

    let headingIndex = 0;
    visitHeadingNodes(tree, (node) => {
      const headingId = headingIds[headingIndex];
      headingIndex += 1;

      if (headingId) {
        node.properties = {
          ...node.properties,
          id: headingId,
        };
      }
    });
  };
}

function renderMermaidBlocks() {
  return (tree: HastNode) => {
    visitMermaidParents(tree);
  };
}

function addHeadingIdAliases() {
  return (tree: HastNode) => {
    const usedIds = new Set<string>();
    collectIds(tree, usedIds);
    visitHastNode(tree, usedIds);
  };
}

function visitMermaidParents(node: HastNode) {
  if (
    node.properties?.["data-leadtype-mermaid-static"] !== undefined ||
    hasClassName(node, "mermaid-source")
  ) {
    return;
  }

  if (node.children) {
    node.children = node.children.map((child) => {
      const mermaidSource = getMermaidSource(child);
      if (!mermaidSource) {
        return child;
      }

      return createMermaidDiagramNode(mermaidSource);
    });
  }

  for (const child of node.children ?? []) {
    visitMermaidParents(child);
  }
}

function hasClassName(node: HastNode, targetClassName: string): boolean {
  const className = node.properties?.className;
  if (Array.isArray(className)) {
    return className.includes(targetClassName);
  }

  if (typeof className === "string") {
    return className.split(" ").includes(targetClassName);
  }

  return false;
}

function visitHeadingNodes(
  node: HastNode,
  onHeading: (node: HastNode) => void
) {
  if (
    node.type === "element" &&
    node.tagName &&
    node.tagName !== "h1" &&
    HEADING_TAGS.has(node.tagName)
  ) {
    onHeading(node);
  }

  for (const child of node.children ?? []) {
    visitHeadingNodes(child, onHeading);
  }
}

function getMermaidSource(node: HastNode): string | null {
  if (node.type !== "element" || node.tagName !== "pre") {
    return null;
  }

  const code = node.children?.find(
    (child) => child.type === "element" && child.tagName === "code"
  );
  const className = code?.properties?.className;
  let classNames: unknown[] = [];
  if (Array.isArray(className)) {
    classNames = className;
  } else if (typeof className === "string") {
    classNames = className.split(" ");
  }

  if (!classNames.includes(MERMAID_CODE_CLASS)) {
    return null;
  }

  return getNodeText(code ?? {}).trim();
}

function createMermaidDiagramNode(source: string): HastNode {
  const diagram = parseMermaidDiagram(source);
  if (!diagram) {
    return createMermaidSourceNode(source);
  }

  const layout = layoutMermaidDiagram(diagram);
  return {
    children: [
      {
        children: [{ type: "text", value: "mermaid" }],
        properties: { className: ["mermaid-caption"] },
        tagName: "span",
        type: "element",
      },
      createMermaidSvgNode(layout),
      createMermaidSourceNode(source),
    ],
    properties: {
      "data-leadtype-mermaid-static": "",
      className: ["mermaid-frame"],
    },
    tagName: "figure",
    type: "element",
  };
}

function createMermaidSourceNode(source: string): HastNode {
  return {
    children: [
      {
        children: [{ type: "text", value: "Source" }],
        tagName: "summary",
        type: "element",
      },
      {
        children: [
          {
            children: [{ type: "text", value: source }],
            properties: { className: [MERMAID_CODE_CLASS] },
            tagName: "code",
            type: "element",
          },
        ],
        tagName: "pre",
        type: "element",
      },
    ],
    properties: { className: ["mermaid-source"] },
    tagName: "details",
    type: "element",
  };
}

function parseMermaidDiagram(source: string): MermaidDiagram | null {
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("flowchart"));
  const nodes = new Map<string, string>();
  const edges: { from: string; to: string }[] = [];

  for (const line of lines) {
    const nodeMatch = MERMAID_NODE_PATTERN.exec(line);
    if (nodeMatch) {
      nodes.set(nodeMatch[1], decodeMermaidLabel(nodeMatch[2]));
      continue;
    }

    const edgeMatch = MERMAID_EDGE_PATTERN.exec(line);
    if (edgeMatch) {
      edges.push({ from: edgeMatch[1], to: edgeMatch[2] });
    }
  }

  if (nodes.size === 0 || edges.length === 0) {
    return null;
  }

  return { edges, nodes };
}

function decodeMermaidLabel(label: string): string {
  return label
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function layoutMermaidDiagram(diagram: MermaidDiagram) {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const nodeId of diagram.nodes.keys()) {
    incoming.set(nodeId, 0);
    outgoing.set(nodeId, []);
  }

  for (const edge of diagram.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const layers = new Map<string, number>();
  const queue = Array.from(diagram.nodes.keys()).filter(
    (nodeId) => (incoming.get(nodeId) ?? 0) === 0
  );
  for (const nodeId of queue) {
    layers.set(nodeId, 0);
  }

  for (const nodeId of queue) {
    const sourceLayer = layers.get(nodeId) ?? 0;
    for (const targetId of outgoing.get(nodeId) ?? []) {
      layers.set(
        targetId,
        Math.max(layers.get(targetId) ?? 0, sourceLayer + 1)
      );
      queue.push(targetId);
    }
  }

  const byLayer = new Map<number, string[]>();
  for (const nodeId of diagram.nodes.keys()) {
    const layer = layers.get(nodeId) ?? 0;
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), nodeId]);
  }

  const nodes: MermaidLayoutNode[] = [];
  for (const [layer, nodeIds] of byLayer) {
    const layerHeight =
      nodeIds.length * SVG_NODE_HEIGHT + (nodeIds.length - 1) * SVG_ROW_GAP;
    const offsetY = Math.max(0, (maxLayerHeight(byLayer) - layerHeight) / 2);

    nodeIds.forEach((nodeId, rowIndex) => {
      nodes.push({
        id: nodeId,
        label: diagram.nodes.get(nodeId) ?? nodeId,
        x: SVG_PADDING_X + layer * SVG_COLUMN_GAP,
        y: SVG_PADDING_Y + offsetY + rowIndex * (SVG_NODE_HEIGHT + SVG_ROW_GAP),
      });
    });
  }

  const width =
    SVG_PADDING_X * 2 +
    (Math.max(...byLayer.keys()) + 1) * SVG_NODE_WIDTH +
    Math.max(...byLayer.keys()) * (SVG_COLUMN_GAP - SVG_NODE_WIDTH);
  const height = SVG_PADDING_Y * 2 + maxLayerHeight(byLayer);

  return { edges: diagram.edges, height, nodes, width };
}

function maxLayerHeight(byLayer: Map<number, string[]>): number {
  return Math.max(
    ...Array.from(byLayer.values()).map(
      (nodeIds) =>
        nodeIds.length * SVG_NODE_HEIGHT + (nodeIds.length - 1) * SVG_ROW_GAP
    )
  );
}

function createMermaidSvgNode(layout: {
  edges: { from: string; to: string }[];
  height: number;
  nodes: MermaidLayoutNode[];
  width: number;
}): HastNode {
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  return {
    children: [
      {
        children: [
          {
            children: [
              {
                properties: {
                  d: "M0,0 L6,3 L0,6 Z",
                  fill: "var(--muted-foreground)",
                },
                tagName: "path",
                type: "element",
              },
            ],
            properties: {
              id: "mermaid-arrow",
              markerHeight: 6,
              markerWidth: 6,
              orient: "auto",
              refX: 6,
              refY: 3,
              viewBox: "0 0 6 6",
            },
            tagName: "marker",
            type: "element",
          },
        ],
        tagName: "defs",
        type: "element",
      },
      ...layout.edges.flatMap((edge) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!(from && to)) {
          return [];
        }

        return [createMermaidEdgeNode(from, to)];
      }),
      ...layout.nodes.map(createMermaidBoxNode),
    ],
    properties: {
      "aria-label": "Mermaid flowchart",
      className: ["mermaid-svg"],
      role: "img",
      viewBox: `0 0 ${layout.width} ${layout.height}`,
    },
    tagName: "svg",
    type: "element",
  };
}

function createMermaidEdgeNode(
  from: MermaidLayoutNode,
  to: MermaidLayoutNode
): HastNode {
  const startX = from.x + SVG_NODE_WIDTH;
  const startY = from.y + SVG_NODE_HEIGHT / 2;
  const endX = to.x;
  const endY = to.y + SVG_NODE_HEIGHT / 2;
  const bendX = startX + Math.max(24, (endX - startX) / 2);

  return {
    properties: {
      className: ["mermaid-edge"],
      d: `M ${startX} ${startY} C ${bendX} ${startY}, ${bendX} ${endY}, ${endX} ${endY}`,
      fill: "none",
      "marker-end": "url(#mermaid-arrow)",
      stroke: "var(--muted-foreground)",
      "stroke-width": 1.4,
    },
    tagName: "path",
    type: "element",
  };
}

function createMermaidBoxNode(node: MermaidLayoutNode): HastNode {
  const lines = node.label.split("\n").slice(0, 4);
  const textY = node.y + SVG_NODE_HEIGHT / 2 - (lines.length - 1) * 7;

  return {
    children: [
      {
        properties: {
          className: ["mermaid-node-box"],
          fill: "var(--accent)",
          height: SVG_NODE_HEIGHT,
          rx: 8,
          stroke: "var(--border)",
          width: SVG_NODE_WIDTH,
          x: node.x,
          y: node.y,
        },
        tagName: "rect",
        type: "element",
      },
      {
        children: lines.map((line, index) => ({
          children: [{ type: "text", value: line }],
          properties: { x: node.x + SVG_NODE_WIDTH / 2, y: textY + index * 14 },
          tagName: "tspan",
          type: "element",
        })),
        properties: {
          className: ["mermaid-node-label"],
          fill: "var(--foreground)",
          "text-anchor": "middle",
        },
        tagName: "text",
        type: "element",
      },
    ],
    tagName: "g",
    type: "element",
  };
}

function collectIds(node: HastNode, usedIds: Set<string>) {
  const id = node.properties?.id;
  if (typeof id === "string") {
    usedIds.add(id);
  }

  for (const child of node.children ?? []) {
    collectIds(child, usedIds);
  }
}

function visitHastNode(node: HastNode, usedIds: Set<string>) {
  if (node.children) {
    const childrenWithAliases: HastNode[] = [];
    for (const child of node.children) {
      if (
        child.type === "element" &&
        child.tagName &&
        HEADING_TAGS.has(child.tagName)
      ) {
        for (const alias of getHeadingAliases(child, usedIds)) {
          childrenWithAliases.push({
            children: [],
            properties: {
              "aria-hidden": "true",
              "data-leadtype-heading-alias": true,
              hidden: true,
              id: alias,
            },
            tagName: "span",
            type: "element",
          });
          usedIds.add(alias);
        }
      }
      childrenWithAliases.push(child);
    }
    node.children = childrenWithAliases;
  }

  for (const child of node.children ?? []) {
    visitHastNode(child, usedIds);
  }
}

function getNodeText(node: HastNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }

  return (node.children ?? []).map(getNodeText).join("");
}

function getNodeTextWithoutCode(node: HastNode): string {
  if (node.tagName === "code") {
    return "";
  }

  if (typeof node.value === "string") {
    return node.value;
  }

  return (node.children ?? []).map(getNodeTextWithoutCode).join("");
}

function getHeadingAliases(node: HastNode, usedIds: Set<string>): string[] {
  const text = getNodeText(node);
  const textWithoutCode = getNodeTextWithoutCode(node);
  const aliases = [
    slugWithPunctuationSeparators(text),
    slugWithRemovedPunctuation(text),
    slugWithPunctuationSeparators(textWithoutCode),
    slugWithRemovedPunctuation(textWithoutCode),
  ];

  return aliases.filter((alias) => alias && !usedIds.has(alias));
}

function slugWithPunctuationSeparators(text: string): string {
  return text
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_PATTERN, "-")
    .replace(EDGE_HYPHENS_PATTERN, "");
}

function slugWithRemovedPunctuation(text: string): string {
  return text
    .toLowerCase()
    .replace(NON_WORD_KEEP_SPACE_PATTERN, "")
    .replace(WHITESPACE_PATTERN, "-")
    .replace(EDGE_HYPHENS_PATTERN, "");
}

export async function renderMarkdown(
  markdown: string,
  options: RenderMarkdownOptions = {}
): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(addCanonicalHeadingIds, options.headingIds ?? [])
    .use(renderMermaidBlocks)
    .use(addHeadingIdAliases)
    .use(rehypeStringify)
    .process(markdown.replace(FRONTMATTER_PATTERN, ""));

  return String(file);
}
