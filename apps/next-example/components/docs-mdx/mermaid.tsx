"use client";

import { mermaid } from "@streamdown/mermaid";
import type { ReactNode } from "react";
import { Streamdown } from "streamdown";

export interface MermaidProps {
  chart?: string;
  children?: ReactNode;
}

export function Mermaid({ chart, children }: MermaidProps) {
  const source = chart ?? (typeof children === "string" ? children : "");
  const markdown = `\`\`\`mermaid\n${source}\n\`\`\``;
  return (
    <div data-leadtype-mermaid="">
      <Streamdown plugins={{ mermaid }}>{markdown}</Streamdown>
    </div>
  );
}
