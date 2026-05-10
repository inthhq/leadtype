import { describe, expect, it } from "vitest";
import {
  normalizeDocsUrl,
  stripDocsExtension,
  stripTrailingSlashes,
  toAbsoluteUrl,
  toDocsUrlPath,
  toMarkdownUrlPath,
} from "./docs-url";

describe("docs URL helpers", () => {
  it("derives canonical docs routes from markdown paths", () => {
    expect(toDocsUrlPath("quickstart.mdx")).toBe("/docs/quickstart");
    expect(toDocsUrlPath("guides\\install.md")).toBe("/docs/guides/install");
    expect(toDocsUrlPath("index.md")).toBe("/docs");
    expect(toDocsUrlPath("guides/index.mdx")).toBe("/docs/guides");
  });

  it("normalizes URL and markdown variants", () => {
    expect(normalizeDocsUrl("/docs/quickstart/?q=install#top")).toBe(
      "/docs/quickstart"
    );
    expect(toMarkdownUrlPath("/docs")).toBe("/docs/index.md");
    expect(toMarkdownUrlPath("/docs/quickstart")).toBe("/docs/quickstart.md");
    expect(stripDocsExtension("guides/quickstart.mdx")).toBe(
      "guides/quickstart"
    );
  });

  it("joins absolute URLs without duplicate trailing slashes", () => {
    expect(stripTrailingSlashes("https://leadtype.dev///")).toBe(
      "https://leadtype.dev"
    );
    expect(toAbsoluteUrl("/docs/quickstart", "https://leadtype.dev/")).toBe(
      "https://leadtype.dev/docs/quickstart"
    );
    expect(toAbsoluteUrl("https://example.com/x", "https://leadtype.dev")).toBe(
      "https://example.com/x"
    );
  });
});
