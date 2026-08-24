import { htmlBlockNames } from "micromark-util-html-tag-name";
import { describe, expect, it } from "vitest";
import {
  createDocsHeadingSlugger,
  docsHtmlBlockTagNames,
  scanDocsMarkdown,
  slugifyDocsHeading,
} from "./docs-heading";

describe("docs HTML block tags", () => {
  it("matches the tag list used by the Markdown parser", () => {
    expect(docsHtmlBlockTagNames).toEqual(htmlBlockNames);
  });
});

describe("createDocsHeadingSlugger", () => {
  it("suffixes duplicate slugs the way extractDocsTableOfContents does", () => {
    const slugger = createDocsHeadingSlugger();

    expect(slugger.slug("Install")).toBe("install");
    expect(slugger.slug("Install")).toBe("install-1");
    expect(slugger.slug("Setup")).toBe("setup");
    expect(slugger.slug("Install")).toBe("install-2");
  });

  it("keeps empty slugs as a counter key", () => {
    const slugger = createDocsHeadingSlugger();

    expect(slugger.slug("!!!")).toBe("");
    expect(slugger.slug("!!!")).toBe("-1");
  });

  it("does not share counts across instances", () => {
    expect(createDocsHeadingSlugger().slug("Install")).toBe("install");
    expect(createDocsHeadingSlugger().slug("Install")).toBe("install");
  });

  it("uses the same base slug as slugifyDocsHeading", () => {
    const title = "Café API: Quick Start!";
    expect(createDocsHeadingSlugger().slug(title)).toBe(
      slugifyDocsHeading(title)
    );
  });

  it("advances past an already-emitted suffixed id", () => {
    const slugger = createDocsHeadingSlugger();

    expect(slugger.slug("Foo")).toBe("foo");
    expect(slugger.slug("Foo")).toBe("foo-1");
    expect(slugger.slug("Foo-1")).toBe("foo-1-1");
  });

  it("skips a later duplicate when the suffixed id was claimed first", () => {
    const slugger = createDocsHeadingSlugger();

    expect(slugger.slug("Foo-1")).toBe("foo-1");
    expect(slugger.slug("Foo")).toBe("foo");
    expect(slugger.slug("Foo")).toBe("foo-2");
  });
});

describe("scanDocsMarkdown", () => {
  it("rejects malformed escaped class binding starts", () => {
    const invalidBindingStarts = [
      "\\x61",
      "\\u{}",
      "\\u{110000}",
      "\\u0030",
      "\\uD800",
    ];

    for (const bindingStart of invalidBindingStarts) {
      const [heading] = scanDocsMarkdown(
        `## <Badge value={class ${bindingStart} { static { function helper() {} /don't/.test(value); } }} /> Install`
      );

      expect(heading).toMatchObject({ kind: "heading", level: 2 });
      expect(heading?.kind === "heading" ? heading.title : "Install").not.toBe(
        "Install"
      );
    }
  });
});
