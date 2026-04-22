import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateDocsSearchFiles } from "./node-index";

describe("generateDocsSearchFiles", () => {
  it("writes minified split search index and content files", async () => {
    const root = await mkdtemp(join(tmpdir(), "inth-docs-search-"));
    try {
      await mkdir(join(root, "docs", "guides"), { recursive: true });
      await writeFile(
        join(root, "docs", "guides", "quickstart.md"),
        [
          "---",
          "title: Quickstart",
          "description: Install the package.",
          "---",
          "",
          "# Quickstart",
          "",
          "Use CommandTabs to install with pnpm.",
        ].join("\n")
      );

      const result = await generateDocsSearchFiles({
        baseUrl: "https://docs.example.com",
        outDir: root,
      });
      const indexJson = await readFile(result.outputPath, "utf-8");
      const contentJson = result.contentOutputPath
        ? await readFile(result.contentOutputPath, "utf-8")
        : "";

      expect(result.docs).toBe(1);
      expect(result.contentOutputPath).toContain("search-content.json");
      expect(result.indexBytes).toBeGreaterThan(0);
      expect(result.contentBytes).toBeGreaterThan(0);
      expect(result.bytes).toBe(result.indexBytes + result.contentBytes);
      expect(indexJson).not.toContain("\n  ");
      expect(contentJson).not.toContain("\n  ");
      expect(JSON.parse(indexJson).content).toBeUndefined();
      expect(JSON.parse(contentJson).chunks[0]).toContain("CommandTabs");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects empty docs directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "inth-docs-search-empty-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });

      await expect(
        generateDocsSearchFiles({
          baseUrl: "https://docs.example.com",
          outDir: root,
        })
      ).rejects.toThrow("found no markdown files");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects output files outside the generated docs directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "inth-docs-search-path-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(
        join(root, "docs", "index.md"),
        "# Docs\n\nGenerated docs content."
      );

      await expect(
        generateDocsSearchFiles({
          baseUrl: "https://docs.example.com",
          outDir: root,
          outputFile: "../search-index.json",
        })
      ).rejects.toThrow("must stay inside");
      await expect(
        generateDocsSearchFiles({
          baseUrl: "https://docs.example.com",
          contentOutputFile: "../search-content.json",
          outDir: root,
        })
      ).rejects.toThrow("must stay inside");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
