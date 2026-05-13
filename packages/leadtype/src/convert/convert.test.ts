import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
});
