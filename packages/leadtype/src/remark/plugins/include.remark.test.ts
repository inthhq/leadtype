import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Root } from "mdast";
import { mdxToMdast } from "satteri";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMdastTransforms,
  runMdastTransforms,
} from "../../markdown/transform";
import {
  createIncludeResolutionCache,
  extractMdxSection,
  parseIncludeSpecifier,
  remarkInclude,
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

  it("reuses raw file reads across section anchors in one cache scope", async () => {
    const filePath = path.join(root, "partial.mdx");
    await writeFile(
      filePath,
      '<section id="one">\nOne\n</section>\n<section id="two">\nTwo\n</section>\n'
    );
    const cache = createIncludeResolutionCache();

    await resolveInclude("partial.mdx#one", { fromDir: root, cache });
    await resolveInclude("partial.mdx#two", { fromDir: root, cache });

    expect(cache.stats.rawFileReads).toBe(1);
    expect(cache.stats.rawFileHits).toBe(1);
  });
});

describe("remarkInclude cache", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "leadtype-remark-include-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("reuses parsed markdown while preserving different requested sections", async () => {
    const partialPath = path.join(root, "partial.mdx");
    await writeFile(
      partialPath,
      '<section id="one">\nOne\n</section>\n<section id="two">\nTwo\n</section>\n'
    );
    const firstPage = path.join(root, "first.mdx");
    const secondPage = path.join(root, "second.mdx");
    const cache = createIncludeResolutionCache();
    const transforms = createMdastTransforms([[remarkInclude, { cache }]]);
    const runIncludeTransform = async (filePath: string, value: string) => {
      const ast = mdxToMdast(value, {
        features: { frontmatter: false, gfm: true },
      }) as Root;
      return await runMdastTransforms(ast, transforms, { filePath, value });
    };

    const first = await runIncludeTransform(
      firstPage,
      '<include src="./partial.mdx#one" />'
    );
    const second = await runIncludeTransform(
      secondPage,
      '<include src="./partial.mdx#two" />'
    );

    expect(JSON.stringify(first)).toContain("One");
    expect(JSON.stringify(first)).not.toContain("Two");
    expect(JSON.stringify(second)).toContain("Two");
    expect(JSON.stringify(second)).not.toContain("One");
    expect(cache.stats.rawFileReads).toBe(1);
    expect(cache.stats.rawFileHits).toBe(1);
    expect(cache.stats.markdownParses).toBe(1);
    expect(cache.stats.markdownParseHits).toBe(1);
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

describe("resolveInclude CRLF normalization", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "leadtype-include-crlf-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("normalizes CRLF in uncached async markdown reads", async () => {
    const filePath = path.join(root, "partial.mdx");
    // Use Buffer.from so core.autocrlf cannot neutralize the fixture
    await writeFile(filePath, Buffer.from("# Heading\r\n\r\nParagraph.\r\n"));

    const result = await resolveInclude("partial.mdx", { fromDir: root });

    expect(result.kind).toBe("markdown");
    expect(result.content).not.toContain("\r");
    expect(result.content).toBe("# Heading\n\nParagraph.\n");
  });

  it("normalizes CRLF in cached async markdown reads", async () => {
    const filePath = path.join(root, "partial.mdx");
    await writeFile(filePath, Buffer.from("# Heading\r\n\r\nParagraph.\r\n"));
    const cache = createIncludeResolutionCache();

    // First call populates the cache, second call hits it
    const first = await resolveInclude("partial.mdx", { fromDir: root, cache });
    const second = await resolveInclude("partial.mdx", {
      fromDir: root,
      cache,
    });

    expect(first.content).not.toContain("\r");
    expect(first.content).toBe("# Heading\n\nParagraph.\n");
    expect(second.content).toBe(first.content);
    expect(cache.stats.rawFileReads).toBe(1);
    expect(cache.stats.rawFileHits).toBe(1);
  });

  it("normalizes CRLF in code-kind includes (no parser layer)", async () => {
    const filePath = path.join(root, "snippet.ts");
    // CR bytes survive without a parser on the code-kind path — this is the
    // highest-risk path because resolution.content is assigned verbatim onto a
    // code node value.
    await writeFile(filePath, Buffer.from("const x = 1;\r\nconst y = 2;\r\n"));

    const result = await resolveInclude("snippet.ts", { fromDir: root });

    expect(result.kind).toBe("code");
    expect(result.content).not.toContain("\r");
    expect(result.content).toBe("const x = 1;\nconst y = 2;\n");
  });

  it("normalizes CRLF in synchronous include reads via remarkInclude plugin", async () => {
    const partialPath = path.join(root, "snippet.ts");
    await writeFile(
      partialPath,
      Buffer.from("const a = 1;\r\nconst b = 2;\r\n")
    );
    const mainPath = path.join(root, "main.mdx");
    const transforms = createMdastTransforms([remarkInclude]);

    const ast = mdxToMdast('<include src="./snippet.ts" />', {
      features: { frontmatter: false, gfm: true },
    }) as Root;
    await runMdastTransforms(ast, transforms, {
      filePath: mainPath,
      value: '<include src="./snippet.ts" />',
    });

    const codeNode = ast.children[0] as { type: string; value: string };
    expect(codeNode.type).toBe("code");
    expect(codeNode.value).not.toContain("\r");
    expect(codeNode.value).toBe("const a = 1;\nconst b = 2;\n");
  });
});
