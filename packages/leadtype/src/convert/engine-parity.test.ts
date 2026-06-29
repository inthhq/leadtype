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
  defaultRemarkPlugins,
  remarkInclude,
  remarkTypeTableToMarkdown,
} from "../remark";
import { convertAllMdx, convertMdxFile } from "./convert";

const tempDirs: string[] = [];
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

function createCapture() {
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
}

async function createTempProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeProjectFile(
  rootDir: string,
  relativePath: string,
  content: string
): Promise<string> {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

function createRemarkPlugins(typeTableBasePath: string): PluggableList {
  return [
    remarkInclude,
    ...defaultRemarkPlugins.filter(
      (plugin) => plugin !== remarkTypeTableToMarkdown
    ),
    [remarkTypeTableToMarkdown, { basePath: typeTableBasePath }] as Pluggable,
  ];
}

async function listFiles(dir: string, ext?: string): Promise<string[]> {
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
}

async function compareTrees(
  remarkDir: string,
  satteriDir: string,
  ext?: string
): Promise<string | undefined> {
  const remarkFiles = await listFiles(remarkDir, ext);
  const satteriFiles = await listFiles(satteriDir, ext);
  if (JSON.stringify(satteriFiles) !== JSON.stringify(remarkFiles)) {
    return `file lists differ: remark=${remarkFiles.length}, satteri=${satteriFiles.length}`;
  }
  for (const relativePath of remarkFiles) {
    const [remarkMarkdown, satteriMarkdown] = await Promise.all([
      readFile(path.join(remarkDir, relativePath), "utf8"),
      readFile(path.join(satteriDir, relativePath), "utf8"),
    ]);
    if (satteriMarkdown !== remarkMarkdown) {
      return `content differs: ${relativePath}`;
    }
  }
  return;
}

async function readSearchIndexWithoutGeneratedAt(
  filePath: string
): Promise<Record<string, unknown>> {
  const index = JSON.parse(await readFile(filePath, "utf8")) as Record<
    string,
    unknown
  >;
  const { generatedAt: _generatedAt, ...stableIndex } = index;
  return stableIndex;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { force: true, recursive: true });
    })
  );
});

describe("markdown engine parity", () => {
  it("matches remark output for high-value MDX constructs", async () => {
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
    const plugins = createRemarkPlugins(projectDir);

    const [remarkResult, satteriResult] = await Promise.all([
      convertMdxFile(sourcePath, plugins, false, { markdownEngine: "remark" }),
      convertMdxFile(sourcePath, plugins, false, { markdownEngine: "satteri" }),
    ]);
    const defaultResult = await convertMdxFile(sourcePath, plugins);

    expect(satteriResult.frontmatter).toBe(remarkResult.frontmatter);
    expect(satteriResult.markdown).toBe(remarkResult.markdown);
    expect(defaultResult.markdown).toBe(satteriResult.markdown);
    expect(satteriResult.ast.type).toBe("root");
    expect(satteriResult.ast.children.length).toBe(
      remarkResult.ast.children.length
    );
  });

  it("matches remark output across this repo's docs corpus", async () => {
    const outRoot = await createTempProject("leadtype-engine-corpus-");
    const remarkOut = path.join(outRoot, "remark");
    const satteriOut = path.join(outRoot, "satteri");
    const plugins = createRemarkPlugins(repoRoot);

    await convertAllMdx({
      srcDir: path.join(repoRoot, "docs"),
      outDir: remarkOut,
      remarkPlugins: plugins,
      enrichFrontmatterFromGit: false,
      markdownEngine: "remark",
      failOnError: true,
    });
    await convertAllMdx({
      srcDir: path.join(repoRoot, "docs"),
      outDir: satteriOut,
      remarkPlugins: plugins,
      enrichFrontmatterFromGit: false,
      markdownEngine: "satteri",
      failOnError: true,
    });

    await expect(compareTrees(remarkOut, satteriOut, ".md")).resolves.toBe(
      undefined
    );
  });

  it("generates matching CLI artifacts with both engines", async () => {
    const srcDir = await createTempProject("leadtype-engine-cli-src-");
    const outRoot = await createTempProject("leadtype-engine-cli-out-");
    const remarkOut = path.join(outRoot, "remark");
    const satteriOut = path.join(outRoot, "satteri");

    await writeProjectFile(
      srcDir,
      "docs/docs.config.ts",
      `export default {
  product: { name: "Parity Product", tagline: "Engine parity." },
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

    const baseArgs = [
      "generate",
      "--src",
      srcDir,
      "--base-url",
      "https://example.com",
      "--format",
      "json",
    ];
    const remarkCapture = createCapture();
    const satteriCapture = createCapture();
    const remarkCode = await runCli(
      [...baseArgs, "--out", remarkOut, "--markdown-engine", "remark"],
      remarkCapture.io
    );
    const satteriCode = await runCli(
      [...baseArgs, "--out", satteriOut, "--markdown-engine", "satteri"],
      satteriCapture.io
    );

    expect(remarkCode).toBe(0);
    expect(satteriCode).toBe(0);
    await expect(
      compareTrees(
        path.join(remarkOut, "docs"),
        path.join(satteriOut, "docs"),
        ".md"
      )
    ).resolves.toBe(undefined);
    await expect(
      readFile(path.join(satteriOut, "llms.txt"), "utf8")
    ).resolves.toBe(await readFile(path.join(remarkOut, "llms.txt"), "utf8"));
    await expect(
      readSearchIndexWithoutGeneratedAt(
        path.join(satteriOut, "docs", "search-index.json")
      )
    ).resolves.toEqual(
      await readSearchIndexWithoutGeneratedAt(
        path.join(remarkOut, "docs", "search-index.json")
      )
    );
  });
});
