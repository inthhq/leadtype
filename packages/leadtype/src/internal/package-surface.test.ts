import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const exportedPaths = Object.keys(packageJson.exports);

describe("package surface", () => {
  it("matches the documented entry-point list", () => {
    const expectedExportedPaths = [
      ".",
      "./mdx",
      "./fumadocs",
      "./remark",
      "./convert",
      "./llm",
      "./llm/readability",
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

  it("keeps optional TypeScript loading out of the remark entry import path", () => {
    const typeTableSource = readFileSync(
      new URL("../remark/plugins/type-table.remark.ts", import.meta.url),
      "utf8"
    );

    expect(typeTableSource).not.toContain('import * as ts from "typescript"');
    expect(typeTableSource).toContain('import type * as ts from "typescript"');
  });

  it("keeps provider answer subpaths free of bash adapters", () => {
    const providerEntryPaths = [
      "../search/ai-index.ts",
      "../search/cloudflare-index.ts",
      "../search/tanstack-index.ts",
      "../search/vercel-index.ts",
    ] as const;

    for (const entryPath of providerEntryPaths) {
      const source = readFileSync(new URL(entryPath, import.meta.url), "utf8");
      expect(source).not.toContain("vercel-bash");
      expect(source).not.toContain("tanstack-bash");
      expect(source).not.toContain("docs-bash");
      expect(source).not.toContain("createDocsBash");
    }
  });
});
