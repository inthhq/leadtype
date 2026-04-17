import type { ReactNode } from "react";

export type MermaidProps = {
  chart?: string;
  children?: ReactNode;
};

/**
 * Placeholder Mermaid renderer. Emits a `<pre data-mermaid>` block so
 * consumer apps can hydrate it with their preferred mermaid client
 * (mermaid.js, react-mermaid2, etc.) or style it as-is.
 */
export function Mermaid({ chart, children }: MermaidProps) {
  const source = chart ?? (typeof children === "string" ? children : "");
  return (
    <pre data-inth-mermaid="">
      <code>{source}</code>
    </pre>
  );
}
