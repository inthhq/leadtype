import { describe, expect, it } from "vitest";
import { createDocsHeadingSlugger, slugifyDocsHeading } from "./docs-heading";

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
});
