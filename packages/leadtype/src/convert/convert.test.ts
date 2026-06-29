import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as v from "valibot";
import { afterEach, describe, expect, it } from "vitest";
import { convertAllMdx, convertMdxFile } from "./convert";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const TEST_GIT_REPOSITORY_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_QUARANTINE_PATH",
  "GIT_WORK_TREE",
] as const;

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-convert-"));
  tempDirs.push(dir);
  return dir;
}

async function git(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {}
): Promise<void> {
  const gitEnv = { ...process.env, ...env };
  for (const key of TEST_GIT_REPOSITORY_ENV_KEYS) {
    delete gitEnv[key];
  }
  await execFileAsync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: gitEnv,
  });
}

function gitAuthorEnv(
  name: string,
  email: string,
  date: string
): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_DATE: date,
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_NAME: name,
    GIT_COMMITTER_DATE: date,
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_NAME: name,
  };
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

  it("enriches frontmatter from one batch git history read", async () => {
    const projectDir = await createTempProject();
    const docsDir = path.join(projectDir, "docs");
    const outputDir = path.join(projectDir, "public");
    const trackedPath = path.join(docsDir, "tracked.mdx");
    const otherPath = path.join(docsDir, "other.mdx");
    const untrackedPath = path.join(docsDir, "untracked.mdx");

    await mkdir(docsDir, { recursive: true });
    await git(projectDir, ["init"]);
    await writeFile(trackedPath, "# Tracked\n\nOriginal.\n");
    await writeFile(otherPath, "# Other\n\nOriginal.\n");
    await git(projectDir, ["add", "docs"]);
    await git(
      projectDir,
      ["commit", "-m", "Add docs"],
      gitAuthorEnv("Alice", "alice@example.com", "2024-01-01T00:00:00Z")
    );

    await writeFile(trackedPath, "# Tracked\n\nUpdated by automation.\n");
    await git(projectDir, ["add", "docs/tracked.mdx"]);
    await git(
      projectDir,
      ["commit", "-m", "Update tracked doc"],
      gitAuthorEnv(
        "github-actions[bot]",
        "bot@example.com",
        "2024-02-01T00:00:00Z"
      )
    );

    await writeFile(untrackedPath, "# Untracked\n\nNot committed.\n");

    await convertAllMdx({
      srcDir: docsDir,
      outDir: outputDir,
      enrichFrontmatterFromGit: true,
    });

    const trackedOutput = await readFile(
      path.join(outputDir, "tracked.md"),
      "utf-8"
    );
    expect(trackedOutput).toContain('lastModified: "2024-02-01T00:00:00Z"');
    expect(trackedOutput).toContain("lastAuthor: Alice");

    const otherOutput = await readFile(
      path.join(outputDir, "other.md"),
      "utf-8"
    );
    expect(otherOutput).toContain('lastModified: "2024-01-01T00:00:00Z"');
    expect(otherOutput).toContain("lastAuthor: Alice");

    const untrackedOutput = await readFile(
      path.join(outputDir, "untracked.md"),
      "utf-8"
    );
    expect(untrackedOutput).not.toContain("lastModified:");
    expect(untrackedOutput).not.toContain("lastAuthor:");
  });

  it("enriches staged files from separate source repositories", async () => {
    const projectDir = await createTempProject();
    const stagedDir = path.join(projectDir, "staged");
    const outputDir = path.join(projectDir, "public");
    const sourceOneDir = path.join(projectDir, "source-one");
    const sourceTwoDir = path.join(projectDir, "source-two");
    const sourceOneFile = path.join(sourceOneDir, "docs", "alpha.mdx");
    const sourceTwoFile = path.join(sourceTwoDir, "docs", "beta.mdx");

    await mkdir(path.dirname(sourceOneFile), { recursive: true });
    await mkdir(path.dirname(sourceTwoFile), { recursive: true });
    await mkdir(stagedDir, { recursive: true });
    await git(sourceOneDir, ["init"]);
    await git(sourceTwoDir, ["init"]);

    await writeFile(sourceOneFile, "# Alpha\n\nFrom source one.\n");
    await writeFile(sourceTwoFile, "# Beta\n\nFrom source two.\n");
    await git(sourceOneDir, ["add", "docs"]);
    await git(
      sourceOneDir,
      ["commit", "-m", "Add alpha"],
      gitAuthorEnv("Alice", "alice@example.com", "2024-03-01T00:00:00Z")
    );
    await git(sourceTwoDir, ["add", "docs"]);
    await git(
      sourceTwoDir,
      ["commit", "-m", "Add beta"],
      gitAuthorEnv("Bob", "bob@example.com", "2024-04-01T00:00:00Z")
    );

    await writeFile(
      path.join(stagedDir, "alpha.mdx"),
      "# Alpha\n\nFrom source one.\n"
    );
    await writeFile(
      path.join(stagedDir, "beta.mdx"),
      "# Beta\n\nFrom source two.\n"
    );

    await convertAllMdx({
      srcDir: stagedDir,
      outDir: outputDir,
      enrichFrontmatterFromGit: true,
      gitSourcePath(filePath) {
        return path.basename(filePath) === "alpha.mdx"
          ? sourceOneFile
          : sourceTwoFile;
      },
    });

    const alphaOutput = await readFile(
      path.join(outputDir, "alpha.md"),
      "utf-8"
    );
    expect(alphaOutput).toContain("lastAuthor: Alice");
    expect(alphaOutput).toContain('lastModified: "2024-03-01T00:00:00Z"');

    const betaOutput = await readFile(path.join(outputDir, "beta.md"), "utf-8");
    expect(betaOutput).toContain("lastAuthor: Bob");
    expect(betaOutput).toContain('lastModified: "2024-04-01T00:00:00Z"');
  });

  it("keeps batch author fallback within the per-file commit limit", async () => {
    const projectDir = await createTempProject();
    const docsDir = path.join(projectDir, "docs");
    const outputDir = path.join(projectDir, "public");
    const filePath = path.join(docsDir, "busy.mdx");
    const commitLimit = 50;
    const botCommitCount = commitLimit + 1;

    await mkdir(docsDir, { recursive: true });
    await git(projectDir, ["init"]);
    await writeFile(filePath, "# Busy\n\nHuman authored.\n");
    await git(projectDir, ["add", "docs"]);
    await git(
      projectDir,
      ["commit", "-m", "Add busy doc"],
      gitAuthorEnv("Alice", "alice@example.com", "2024-01-01T00:00:00Z")
    );

    for (const index of Array.from(
      { length: botCommitCount },
      (_, itemIndex) => itemIndex
    )) {
      await writeFile(filePath, `# Busy\n\nBot update ${index}.\n`);
      await git(projectDir, ["add", "docs/busy.mdx"]);
      await git(
        projectDir,
        ["commit", "-m", `Bot update ${index}`],
        gitAuthorEnv(
          "github-actions[bot]",
          "bot@example.com",
          new Date(Date.UTC(2024, 1, 1, 0, index + 1)).toISOString()
        )
      );
    }

    await convertAllMdx({
      srcDir: docsDir,
      outDir: outputDir,
      enrichFrontmatterFromGit: true,
    });

    const output = await readFile(path.join(outputDir, "busy.md"), "utf-8");
    expect(output).toContain("lastModified:");
    expect(output).not.toContain("lastAuthor:");
  });
});

describe("convertMdxFile", () => {
  it("enriches nested relative file paths from git", async () => {
    const projectDir = await createTempProject();
    const previousCwd = process.cwd();
    const filePath = path.join(projectDir, "docs", "guides", "page.mdx");

    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await git(projectDir, ["init"]);
      await writeFile(filePath, "# Page\n\nNested relative path.\n");
      await git(projectDir, ["add", "docs"]);
      await git(
        projectDir,
        ["commit", "-m", "Add nested page"],
        gitAuthorEnv("Alice", "alice@example.com", "2024-05-01T00:00:00Z")
      );

      process.chdir(projectDir);
      const result = await convertMdxFile("docs/guides/page.mdx", [], true);

      expect(result.frontmatter).toContain("lastAuthor: Alice");
      expect(result.frontmatter).toContain(
        'lastModified: "2024-05-01T00:00:00Z"'
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

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
