import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const exportedPaths = Object.keys(packageJson.exports);

describe("package surface", () => {
  it("matches the documented entry-point list", () => {
    const expectedExportedPaths = [
      ".",
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
    ] as const;

    expect(exportedPaths).toHaveLength(expectedExportedPaths.length);
    expect(new Set(exportedPaths)).toEqual(new Set(expectedExportedPaths));
  });

  it("does not expose framework-specific runtime component adapters", () => {
    expect(exportedPaths).not.toContain("./react");
    expect(exportedPaths).not.toContain("./vue");
    expect(exportedPaths).not.toContain("./svelte");
  });
});
