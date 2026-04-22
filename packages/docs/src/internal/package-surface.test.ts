import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const exportedPaths = Object.keys(packageJson.exports);

describe("package surface", () => {
  it("does not expose runtime component entry points", () => {
    expect(exportedPaths).toEqual([
      "./remark",
      "./convert",
      "./llm",
      "./search",
      "./search/node",
      "./search/ai",
      "./search/bash",
      "./search/vercel",
      "./search/tanstack",
      "./search/cloudflare",
      "./lint",
    ]);
  });

  it("does not expose root or runtime component adapters", () => {
    expect(exportedPaths).not.toContain(".");
    expect(exportedPaths).not.toContain("./react");
  });
});
