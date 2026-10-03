<script setup lang="ts">
import { computed } from "vue";

const MERMAID_NODE_PATTERN = /^([A-Za-z_][\w-]*)\["([\s\S]+)"\]$/;
const MERMAID_EDGE_PATTERN = /^([A-Za-z_][\w-]*)\s*-->\s*([A-Za-z_][\w-]*)$/;
const SVG_NODE_WIDTH = 154;
const SVG_NODE_HEIGHT = 56;
const SVG_COLUMN_GAP = 178;
const SVG_ROW_GAP = 82;
const SVG_PADDING_X = 44;
const SVG_PADDING_Y = 34;
const HASH_MODULUS = 100_000;

interface MermaidDiagram {
  edges: { from: string; to: string }[];
  nodes: Map<string, string>;
}

interface MermaidLayoutNode {
  id: string;
  label: string;
  lines: string[];
  textY: number;
  x: number;
  y: number;
}

const props = withDefaults(
  defineProps<{
    class?: string | null;
    code?: string;
    filename?: string | null;
    highlights?: number[];
    language?: string | null;
    meta?: string | null;
  }>(),
  {
    class: null,
    code: "",
    filename: null,
    highlights: () => [],
    language: null,
    meta: null,
  }
);

const isMermaid = computed(
  () =>
    props.language === "mermaid" ||
    props.class?.split(" ").includes("language-mermaid")
);
const layout = computed(() => {
  if (!isMermaid.value) {
    return null;
  }

  const diagram = parseMermaidDiagram(props.code);
  return diagram ? layoutMermaidDiagram(diagram) : null;
});
const markerId = computed(() => `mermaid-arrow-${hashString(props.code)}`);

function parseMermaidDiagram(source: string): MermaidDiagram | null {
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("flowchart"));
  const nodes = new Map<string, string>();
  const edges: { from: string; to: string }[] = [];

  for (const line of lines) {
    const nodeMatch = MERMAID_NODE_PATTERN.exec(line);
    if (nodeMatch?.[1] && nodeMatch[2]) {
      nodes.set(nodeMatch[1], decodeMermaidLabel(nodeMatch[2]));
      continue;
    }

    const edgeMatch = MERMAID_EDGE_PATTERN.exec(line);
    if (edgeMatch?.[1] && edgeMatch[2]) {
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

  const maxHeight = maxLayerHeight(byLayer);
  const nodes: MermaidLayoutNode[] = [];
  for (const [layer, nodeIds] of byLayer) {
    const layerHeight =
      nodeIds.length * SVG_NODE_HEIGHT + (nodeIds.length - 1) * SVG_ROW_GAP;
    const offsetY = Math.max(0, (maxHeight - layerHeight) / 2);

    for (const [rowIndex, nodeId] of nodeIds.entries()) {
      const label = diagram.nodes.get(nodeId) ?? nodeId;
      const lines = label.split("\n").slice(0, 4);
      const y =
        SVG_PADDING_Y + offsetY + rowIndex * (SVG_NODE_HEIGHT + SVG_ROW_GAP);
      nodes.push({
        id: nodeId,
        label,
        lines,
        textY: y + SVG_NODE_HEIGHT / 2 - (lines.length - 1) * 7,
        x: SVG_PADDING_X + layer * SVG_COLUMN_GAP,
        y,
      });
    }
  }

  const lastLayer = Math.max(...byLayer.keys());
  const width =
    SVG_PADDING_X * 2 +
    (lastLayer + 1) * SVG_NODE_WIDTH +
    lastLayer * (SVG_COLUMN_GAP - SVG_NODE_WIDTH);
  const height = SVG_PADDING_Y * 2 + maxHeight;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = diagram.edges.flatMap((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    return from && to ? [{ ...edge, path: createEdgePath(from, to) }] : [];
  });

  return { edges, height, nodes, width };
}

function maxLayerHeight(byLayer: Map<number, string[]>): number {
  return Math.max(
    ...Array.from(byLayer.values()).map(
      (nodeIds) =>
        nodeIds.length * SVG_NODE_HEIGHT + (nodeIds.length - 1) * SVG_ROW_GAP
    )
  );
}

function createEdgePath(
  from: MermaidLayoutNode,
  to: MermaidLayoutNode
): string {
  const startX = from.x + SVG_NODE_WIDTH;
  const startY = from.y + SVG_NODE_HEIGHT / 2;
  const endX = to.x;
  const endY = to.y + SVG_NODE_HEIGHT / 2;
  const bendX = startX + Math.max(24, (endX - startX) / 2);
  return `M ${startX} ${startY} C ${bendX} ${startY}, ${bendX} ${endY}, ${endX} ${endY}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % HASH_MODULUS;
  }

  return hash.toString(36);
}
</script>

<template>
  <figure
    v-if="layout"
    class="mermaid-frame"
    data-leadtype-mermaid-static=""
  >
    <span class="mermaid-caption">mermaid</span>
    <svg
      aria-label="Mermaid flowchart"
      class="mermaid-svg"
      role="img"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
    >
      <defs>
        <marker
          :id="markerId"
          markerHeight="6"
          markerWidth="6"
          orient="auto"
          refX="6"
          refY="3"
          viewBox="0 0 6 6"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      <path
        v-for="edge in layout.edges"
        :key="`${edge.from}-${edge.to}`"
        class="mermaid-edge"
        :d="edge.path"
        fill="none"
        :marker-end="`url(#${markerId})`"
        stroke="var(--muted-foreground)"
        stroke-width="1.4"
      />
      <g v-for="node in layout.nodes" :key="node.id">
        <rect
          class="mermaid-node-box"
          fill="var(--accent)"
          :height="SVG_NODE_HEIGHT"
          rx="8"
          stroke="var(--border)"
          :width="SVG_NODE_WIDTH"
          :x="node.x"
          :y="node.y"
        />
        <text
          class="mermaid-node-label"
          fill="var(--foreground)"
          text-anchor="middle"
        >
          <tspan
            v-for="(line, index) in node.lines"
            :key="`${node.id}-${line}`"
            :x="node.x + SVG_NODE_WIDTH / 2"
            :y="node.textY + index * 14"
          >
            {{ line }}
          </tspan>
        </text>
      </g>
    </svg>
    <details class="mermaid-source">
      <summary>Source</summary>
      <pre><code class="language-mermaid">{{ code }}</code></pre>
    </details>
  </figure>
  <details v-else-if="isMermaid" class="mermaid-source">
    <summary>Source</summary>
    <pre><code class="language-mermaid">{{ code }}</code></pre>
  </details>
  <pre v-else :class="$props.class"><slot /></pre>
</template>
