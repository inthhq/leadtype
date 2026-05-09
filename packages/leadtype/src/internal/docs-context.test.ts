import { describe, expect, it } from "vitest";
import { deriveDocContext, resolvePlaceholderStrings } from "./docs-context";

describe("deriveDocContext", () => {
  it("derives arbitrary framework slugs from framework routes", () => {
    expect(
      deriveDocContext("/tmp/docs/frameworks/vue/quickstart.mdx")
    ).toMatchObject({
      framework: "vue",
      frameworkDocsBase: "/docs/frameworks/vue",
    });
  });

  it("derives arbitrary framework slugs from Windows framework routes", () => {
    expect(
      deriveDocContext("\\tmp\\docs\\frameworks\\vue\\quickstart.mdx")
    ).toMatchObject({
      framework: "vue",
      frameworkDocsBase: "/docs/frameworks/vue",
    });
  });

  it("does not infer a framework from shared content paths", () => {
    expect(
      deriveDocContext("/tmp/docs/shared/concepts/common.mdx")
    ).toMatchObject({
      framework: null,
      frameworkDocsBase: null,
    });
  });

  it("does not infer a framework from Windows shared content paths", () => {
    expect(
      deriveDocContext("\\tmp\\docs\\shared\\concepts\\common.mdx")
    ).toMatchObject({
      framework: null,
      frameworkDocsBase: null,
    });
  });
});

describe("resolvePlaceholderStrings", () => {
  it("preserves non-plain objects while recursing through plain objects", () => {
    const publishedAt = new Date("2026-04-19T00:00:00.000Z");

    const resolved = resolvePlaceholderStrings(
      {
        nested: {
          url: "/docs/frameworks/{framework}/quickstart",
        },
        publishedAt,
      },
      deriveDocContext("/tmp/docs/frameworks/vue/quickstart.mdx")
    );

    expect(resolved.nested.url).toBe("/docs/frameworks/vue/quickstart");
    expect(resolved.publishedAt).toBe(publishedAt);
  });
});
