import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pluggable, PluggableList } from "unified";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli";
import {
  defaultMarkdownTransforms,
  includeMarkdown,
  nativeMarkdownComponentsToMarkdown,
} from "../markdown";
import { convertAllMdx, convertMdxFile } from "./convert";

const tempDirs: string[] = [];
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

const createCapture = () => {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
          return true;
        },
      },
      stdout: {
        write: (chunk: string) => {
          stdout += chunk;
          return true;
        },
      },
    },
    get stderr() {
      return stderr;
    },
    get stdout() {
      return stdout;
    },
  };
};

const createTempProject = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const writeProjectFile = async (
  rootDir: string,
  relativePath: string,
  content: string
): Promise<string> => {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
};

const createMarkdownTransforms = (typeTableBasePath: string): PluggableList => [
  includeMarkdown,
  ...defaultMarkdownTransforms.filter(
    (plugin) => plugin !== nativeMarkdownComponentsToMarkdown
  ),
  [
    nativeMarkdownComponentsToMarkdown,
    { typeTable: { basePath: typeTableBasePath } },
  ] as Pluggable,
];

const listFiles = async (dir: string, ext?: string): Promise<string[]> => {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (!ext || entry.name.endsWith(ext)) {
        files.push(path.relative(dir, full));
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
};

const compareTrees = async (
  expectedDir: string,
  actualDir: string,
  ext?: string
): Promise<string | undefined> => {
  const expectedFiles = await listFiles(expectedDir, ext);
  const actualFiles = await listFiles(actualDir, ext);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    return `file lists differ: expected=${expectedFiles.length}, actual=${actualFiles.length}`;
  }
  for (const relativePath of expectedFiles) {
    const [expectedMarkdown, actualMarkdown] = await Promise.all([
      readFile(path.join(expectedDir, relativePath), "utf8"),
      readFile(path.join(actualDir, relativePath), "utf8"),
    ]);
    if (actualMarkdown !== expectedMarkdown) {
      return `content differs: ${relativePath}`;
    }
  }
  return;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { force: true, recursive: true });
    })
  );
});

describe("native markdown output", () => {
  it("renders high-value MDX constructs through the native pipeline", async () => {
    const projectDir = await createTempProject("leadtype-engine-fixture-");
    await writeProjectFile(
      projectDir,
      "types.ts",
      `export interface FixtureOptions {
  /** Whether parity is enabled. */
  enabled: boolean;
}`
    );
    await writeProjectFile(
      projectDir,
      "docs/shared.mdx",
      `## Included

Included body.
`
    );
    const sourcePath = await writeProjectFile(
      projectDir,
      "docs/page.mdx",
      `---
title: "Parity"
description: "Engine parity fixture."
---

import { Demo } from "./demo";

{/* hidden comment */}

# Parity

| Name | Value |
| --- | --- |
| Engine | Satteri |

- [x] checked

<Callout type="note">Remember this.</Callout>

<Cards>
  <Card title="Docs" description="Read docs." href="/docs" />
</Cards>

<include src="./shared.mdx" />

<AutoTypeTable name="FixtureOptions" path="./types.ts" />
`
    );
    const plugins = createMarkdownTransforms(projectDir);

    const result = await convertMdxFile(sourcePath, plugins);
    const defaultResult = await convertMdxFile(sourcePath, plugins);

    expect(result.frontmatter).toContain("title: Parity");
    expect(result.markdown).toContain("# Parity");
    expect(result.markdown).toContain("> Remember this.");
    expect(result.markdown).toContain("## Included");
    expect(result.markdown).toContain(
      "|enabled|boolean|Whether parity is enabled."
    );
    expect(result.markdown).not.toContain("<include");
    expect(result.markdown).not.toContain("hidden comment");
    expect(defaultResult.markdown).toBe(result.markdown);
    expect(result.ast.type).toBe("root");
  });

  it("generates deterministic native output across this repo's docs corpus", async () => {
    const outRoot = await createTempProject("leadtype-engine-corpus-");
    const firstOut = path.join(outRoot, "first");
    const secondOut = path.join(outRoot, "second");
    const plugins = createMarkdownTransforms(repoRoot);

    await convertAllMdx({
      srcDir: path.join(repoRoot, "docs"),
      outDir: firstOut,
      markdownTransforms: plugins,
      enrichFrontmatterFromGit: false,
      failOnError: true,
    });
    await convertAllMdx({
      srcDir: path.join(repoRoot, "docs"),
      outDir: secondOut,
      markdownTransforms: plugins,
      enrichFrontmatterFromGit: false,
      failOnError: true,
    });

    await expect(compareTrees(firstOut, secondOut, ".md")).resolves.toBe(
      undefined
    );
  });

  it("generates CLI artifacts with the default Satteri parser", async () => {
    const srcDir = await createTempProject("leadtype-satteri-cli-src-");
    const outDir = await createTempProject("leadtype-satteri-cli-out-");
    const capture = createCapture();

    await writeProjectFile(
      srcDir,
      "docs/docs.config.ts",
      `export default {
  product: { name: "Satteri Product", tagline: "Parser output." },
  groups: [{ slug: "guide", title: "Guide" }],
};`
    );
    await writeProjectFile(
      srcDir,
      "docs/quickstart.mdx",
      `---
title: "Quickstart"
description: "Start here."
group: guide
---

# Quickstart

<Callout type="note">Same output.</Callout>
`
    );

    const code = await runCli(
      [
        "generate",
        "--src",
        srcDir,
        "--out",
        outDir,
        "--base-url",
        "https://example.com",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(0);
    expect(capture.stderr).toContain("generate.done");
    await expect(
      readFile(path.join(outDir, "docs", "quickstart.md"), "utf8")
    ).resolves.toContain("> Same output.");
    await expect(
      readFile(path.join(outDir, "llms.txt"), "utf8")
    ).resolves.toContain("Satteri Product");
    expect(existsSync(path.join(outDir, "docs", "search-index.json"))).toBe(
      true
    );
  });
});
