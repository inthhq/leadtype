import { describe, expect, it } from "vitest";
import { stripSnippetDirectives } from "./strip-snippet-directives.remark";

describe("stripSnippetDirectives", () => {
  it("removes directive lines", () => {
    expect(
      stripSnippetDirectives(
        "// @noErrors — fragment\n// @check\n// @filename: setup.ts\nconst x = 1;\n"
      )
    ).toBe("const x = 1;\n");
  });

  it("hides everything above the last cut marker", () => {
    expect(
      stripSnippetDirectives(
        'import { setup } from "pkg";\nsetup();\n// ---cut---\nconst visible = true;\n'
      )
    ).toBe("const visible = true;\n");
  });

  it("leaves ordinary comments and code alone", () => {
    const value = "// a normal comment\nconst checkout = 1; // @-ish text\n";
    expect(stripSnippetDirectives(value)).toBe(value);
  });
});
