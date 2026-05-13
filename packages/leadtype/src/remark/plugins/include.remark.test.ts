import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractMdxSection,
  parseIncludeSpecifier,
  resolveInclude,
  resolveIncludePath,
} from "./include.remark";

describe("parseIncludeSpecifier", () => {
  it("returns just the file when there is no #section", () => {
    expect(parseIncludeSpecifier("./shared/setup.mdx")).toEqual({
      file: "./shared/setup.mdx",
    });
  });

  it("splits the specifier on the last # for section anchors", () => {
    expect(parseIncludeSpecifier("./shared/setup.mdx#install")).toEqual({
      file: "./shared/setup.mdx",
      section: "install",
    });
  });

  it("treats only the LAST # as the section delimiter", () => {
    expect(parseIncludeSpecifier("./shared/#weird/setup.mdx#install")).toEqual({
      file: "./shared/#weird/setup.mdx",
      section: "install",
    });
  });
});

describe("resolveIncludePath", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "leadtype-include-path-"));
    await writeFile(path.join(root, "partial.mdx"), "body\n");
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("prefers a baseDir override over fromDir", () => {
    const resolved = resolveIncludePath("partial.mdx", {
      fromDir: "/does/not/exist",
      baseDir: root,
    });
    expect(resolved).toBe(path.join(root, "partial.mdx"));
  });

  it("resolves relative to fromDir when the file exists there", () => {
    const resolved = resolveIncludePath("partial.mdx", { fromDir: root });
    expect(resolved).toBe(path.join(root, "partial.mdx"));
  });

  it("falls back to basePaths when fromDir misses", () => {
    const resolved = resolveIncludePath("partial.mdx", {
      fromDir: "/does/not/exist",
      basePaths: [root],
    });
    expect(resolved).toBe(path.join(root, "partial.mdx"));
  });
});

describe("resolveInclude", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "leadtype-resolve-include-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("returns markdown content for .mdx files and strips frontmatter", async () => {
    const filePath = path.join(root, "partial.mdx");
    await writeFile(filePath, "---\ntitle: x\n---\nHello\n");

    const result = await resolveInclude("partial.mdx", { fromDir: root });

    expect(result).toMatchObject({
      kind: "markdown",
      content: "Hello\n",
      resolvedPath: filePath,
    });
    expect(result.kind === "markdown" && result.section).toBeUndefined();
  });

  it("carries through the section anchor parsed from the specifier", async () => {
    const filePath = path.join(root, "partial.mdx");
    await writeFile(filePath, "body\n");

    const result = await resolveInclude("partial.mdx#install", {
      fromDir: root,
    });

    expect(result).toEqual({
      kind: "markdown",
      content: "body\n",
      resolvedPath: filePath,
      section: "install",
    });
  });

  it("classifies non-markdown files as code blocks", async () => {
    const filePath = path.join(root, "snippet.ts");
    await writeFile(filePath, "export const x = 1;\n");

    const result = await resolveInclude("snippet.ts", { fromDir: root });

    expect(result).toEqual({
      kind: "code",
      content: "export const x = 1;\n",
      lang: "ts",
      resolvedPath: filePath,
    });
  });

  it("forces code output when lang is set even for .md files", async () => {
    const filePath = path.join(root, "doc.md");
    await writeFile(filePath, "# heading\n");

    const result = await resolveInclude("doc.md", {
      fromDir: root,
      lang: "markdown",
    });

    expect(result).toMatchObject({
      kind: "code",
      lang: "markdown",
      content: "# heading\n",
    });
  });

  it("throws when the target file does not exist", async () => {
    await expect(
      resolveInclude("missing.mdx", { fromDir: root })
    ).rejects.toThrow(/ENOENT|no such file/i);
  });
});

describe("extractMdxSection", () => {
  it("returns null when no section matches", () => {
    expect(
      extractMdxSection({ type: "root", children: [] }, "anything")
    ).toBeNull();
  });

  it("returns the children of a matching <section> mdxJsxFlowElement", () => {
    const heading = {
      type: "heading",
      depth: 2,
      children: [{ type: "text", value: "Install" }],
    } as const;
    const root = {
      type: "root" as const,
      children: [
        {
          type: "mdxJsxFlowElement",
          name: "section",
          attributes: [
            { type: "mdxJsxAttribute", name: "id", value: "install" },
          ],
          children: [heading],
        },
      ],
    } as unknown as Parameters<typeof extractMdxSection>[0];

    const extracted = extractMdxSection(root, "install");
    expect(extracted?.children).toEqual([heading]);
  });
});
