import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as v from "valibot";
import { afterEach, describe, expect, it } from "vitest";
import { convertAllMdx, convertMdxFile } from "./convert";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-convert-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

describe("convertAllMdx", () => {
  it("defaults to the framework-neutral docs directory", async () => {
    const projectDir = await createTempProject();
    const previousCwd = process.cwd();
    try {
      await mkdir(path.join(projectDir, "docs", "guides"), {
        recursive: true,
      });
      await writeFile(
        path.join(projectDir, "docs", "guides", "quickstart.mdx"),
        "# Quickstart\n\nInstall leadtype."
      );

      process.chdir(projectDir);
      await convertAllMdx();

      const outputPath = path.join(
        projectDir,
        "public",
        "guides",
        "quickstart.md"
      );
      expect(existsSync(outputPath)).toBe(true);
      await expect(readFile(outputPath, "utf-8")).resolves.toContain(
        "Install leadtype."
      );
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe("convertMdxFile", () => {
  it("returns ast, parsed frontmatter data, and serialized markdown", async () => {
    const dir = await createTempProject();
    const filePath = path.join(dir, "page.mdx");
    await writeFile(
      filePath,
      "---\ntitle: Hello\ndescription: from convertMdxFile\n---\n\n# Heading\n\nBody.\n"
    );

    const result = await convertMdxFile(filePath);

    expect(result.ast.type).toBe("root");
    expect(result.data).toMatchObject({
      title: "Hello",
      description: "from convertMdxFile",
    });
    expect(result.markdown).toContain("# Heading");
    expect(result.markdown).toContain("Body.");
    expect(result.frontmatter).toContain("title: Hello");
  });

  it("synthesizes frontmatter from the body when none is authored", async () => {
    const dir = await createTempProject();
    const filePath = path.join(dir, "untitled.mdx");
    await writeFile(filePath, "# Custom Title\n\nIntro paragraph.\n");

    const result = await convertMdxFile(filePath);

    expect(result.data.title).toBe("Custom Title");
    expect(result.frontmatter).toContain("title:");
  });

  it("applies the supplied remark plugins before stringification", async () => {
    const dir = await createTempProject();
    const filePath = path.join(dir, "page.mdx");
    await writeFile(filePath, "# Hi\n\nBody.\n");

    let pluginRan = false;
    const tracerPlugin = () => () => {
      pluginRan = true;
    };

    const result = await convertMdxFile(filePath, [tracerPlugin]);
    expect(pluginRan).toBe(true);
    expect(result.markdown).toContain("# Hi");
  });

  it("validates and exposes transformed custom frontmatter", async () => {
    const dir = await createTempProject();
    const filePath = path.join(dir, "reference.mdx");
    await writeFile(filePath, "---\ntitle: API\n---\n\n# API\n");

    const frontmatterSchema = v.object({
      title: v.string(),
      apiArea: v.string(),
    });

    const result = await convertMdxFile(filePath, [], false, {
      frontmatterSchema,
      transformers: [
        {
          name: "api-area",
          afterFrontmatter(page) {
            return {
              ...page,
              data: {
                ...page.data,
                apiArea: "reference",
              },
            };
          },
        },
      ],
    });

    expect(result.data.apiArea).toBe("reference");
    expect(result.frontmatter).toContain("apiArea: reference");
  });

  it("rebuilds markdown when afterFrontmatter changes content", async () => {
    const dir = await createTempProject();
    const filePath = path.join(dir, "page.mdx");
    await writeFile(filePath, "---\ntitle: Hello\n---\n\n# Original\n");

    const result = await convertMdxFile(filePath, [], false, {
      transformers: [
        {
          name: "rewrite-body",
          afterFrontmatter(page) {
            return {
              ...page,
              content: "# Rewritten\n\nUpdated body.\n",
            };
          },
        },
      ],
    });

    expect(result.markdown).toContain("# Rewritten");
    expect(result.markdown).toContain("Updated body.");
    expect(result.markdown).not.toContain("# Original");
  });

  it("wraps transformer failures with the transformer name and file path", async () => {
    const dir = await createTempProject();
    const filePath = path.join(dir, "broken.mdx");
    await writeFile(filePath, "---\ntitle: Broken\n---\n\n# Broken\n");

    await expect(
      convertMdxFile(filePath, [], false, {
        transformers: [
          {
            name: "explode",
            afterFrontmatter() {
              throw new Error("nope");
            },
          },
        ],
      })
    ).rejects.toThrow(`Transformer "explode" failed in afterFrontmatter`);
  });
});
