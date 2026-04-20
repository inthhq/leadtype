import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Callout } from "./callout";
import { Card } from "./card";
import { Mermaid } from "./mermaid";
import { TypeTable } from "./type-table";

describe("component semantics", () => {
  it("renders callouts as notes with a default title", () => {
    const markup = renderToStaticMarkup(
      <Callout variant="warning">Watch out.</Callout>
    );

    expect(markup).toContain('role="note"');
    expect(markup).toContain("Warning");
    expect(markup).toContain("Watch out.");
  });

  it("adds safe external link attributes to cards", () => {
    const markup = renderToStaticMarkup(
      <Card
        description="External guide"
        href="https://example.com/docs"
        title="External"
      />
    );

    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener"');
  });

  it("renders mermaid content as a plain code block fallback", () => {
    const markup = renderToStaticMarkup(
      <Mermaid chart={"flowchart TD\n  A[MDX] --> B[Browser]"} />
    );

    expect(markup).toContain("data-inth-mermaid");
    expect(markup).toContain("flowchart TD");
  });

  it("drops unsafe type description links", () => {
    const markup = renderToStaticMarkup(
      <TypeTable
        type={{
          command: {
            description: "Command template",
            type: "string",
            typeDescriptionLink: "javascript:alert('xss')",
          },
        }}
      />
    );

    expect(markup).not.toContain("javascript:alert");
    expect(markup).not.toContain("<a");
    expect(markup).toContain("<code>string</code>");
  });
});
