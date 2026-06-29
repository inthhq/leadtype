import type { Root } from "mdast";
import { describe, expect, it } from "vitest";
import { stringifyMarkdown } from "./stringify";

describe("stringifyMarkdown", () => {
  it("serializes common block and inline markdown nodes", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 2,
          children: [{ type: "text", value: "Install" }],
        },
        {
          type: "paragraph",
          children: [
            { type: "text", value: "Use " },
            { type: "strong", children: [{ type: "text", value: "Bun" }] },
            { type: "text", value: " and " },
            { type: "inlineCode", value: "leadtype" },
            { type: "text", value: "." },
          ],
        },
      ],
    };

    expect(stringifyMarkdown(tree)).toBe(
      "## Install\n\nUse **Bun** and `leadtype`.\n"
    );
  });

  it("serializes tables and nested blockquotes", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "table",
          align: ["left", null],
          children: [
            {
              type: "tableRow",
              children: [
                { type: "tableCell", children: [{ type: "text", value: "A" }] },
                { type: "tableCell", children: [{ type: "text", value: "B" }] },
              ],
            },
            {
              type: "tableRow",
              children: [
                { type: "tableCell", children: [{ type: "text", value: "1" }] },
                { type: "tableCell", children: [{ type: "text", value: "2" }] },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: "Quoted" }],
            },
          ],
        },
      ],
    };

    expect(stringifyMarkdown(tree)).toBe(
      "| A | B |\n| :--- | --- |\n| 1 | 2 |\n\n> Quoted\n"
    );
  });
});
