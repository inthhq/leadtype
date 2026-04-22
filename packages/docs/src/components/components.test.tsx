import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Callout } from "./callout";
import { Card } from "./card";
import { CommandTabs } from "./command-tabs";
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

  it("renders install commands from package names", () => {
    const markup = renderToStaticMarkup(
      <CommandTabs command="@inth/docs" mode="install" />
    );

    expect(markup).toContain("npm install @inth/docs");
  });

  it("keeps custom package manager command templates", () => {
    const markup = renderToStaticMarkup(
      <CommandTabs command="{pm} exec inth-docs-lint" />
    );

    expect(markup).toContain("npm exec inth-docs-lint");
  });

  it("renders create commands from starter names", () => {
    const markup = renderToStaticMarkup(
      <CommandTabs command="next-app" mode="create" />
    );

    expect(markup).toContain("npm create next-app");
  });

  it("drops unsafe type description links", () => {
    const markup = renderToStaticMarkup(
      <TypeTable
        properties={{
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
