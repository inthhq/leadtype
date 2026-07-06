"use client";

import { mermaid } from "@streamdown/mermaid";
import { Children, isValidElement, type ReactNode } from "react";
import { Streamdown } from "streamdown";

export interface MermaidProps {
  chart?: string;
  children?: ReactNode;
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textFromNode).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromNode(node.props.children);
  }
  return "";
}

function textFromChildren(children: ReactNode): string {
  return Children.toArray(children).map(textFromNode).join("");
}

export function Mermaid({ chart, children }: MermaidProps) {
  const source = chart ?? textFromChildren(children);
  const markdown = `\`\`\`mermaid\n${source}\n\`\`\``;
  return (
    <div data-leadtype-mermaid="">
      <Streamdown plugins={{ mermaid }}>{markdown}</Streamdown>
    </div>
  );
}
