import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintDocs } from "./runner";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "inth-docs-lint-"));
  tempDirs.push(dir);
  return dir;
}

async function writeProjectFile(
  rootDir: string,
  relativePath: string,
  content: string
): Promise<void> {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

describe("lintDocs link validation", () => {
  it("flags cross-framework links after resolving shared imports", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "frameworks", "next", "concepts", "overview.mdx"),
      `---
title: Overview
---
<import src="../../../shared/concepts/common.mdx" />
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "shared", "concepts", "common.mdx"),
      `[Policy Packs](/docs/frameworks/react/concepts/policy-packs)
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "frameworks", "react", "concepts", "policy-packs.mdx"),
      `---
title: React Policy Packs
---
Body
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "frameworks", "next", "concepts", "policy-packs.mdx"),
      `---
title: Next Policy Packs
---
Body
`
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
    });

    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "frameworks/next/concepts/overview.mdx",
          kind: "content",
          rule: "cross-framework-link",
        }),
      ])
    );
  });

  it("accepts placeholder-based shared links in the importing framework", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "frameworks", "next", "concepts", "overview.mdx"),
      `---
title: Overview
availableIn:
  - framework: next
    url: /docs/frameworks/{framework}/concepts/policy-packs
---
<import src="../../../shared/concepts/common.mdx" />
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "shared", "concepts", "common.mdx"),
      `[Policy Packs](/docs/frameworks/{framework:react}/concepts/policy-packs)
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "frameworks", "next", "concepts", "policy-packs.mdx"),
      `---
title: Next Policy Packs
---
Body
`
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
    });

    expect(result.summary.errors).toBe(0);
  });

  it("flags missing docs routes and unresolved placeholders", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: Overview
availableIn:
  - framework: next
    url: /docs/frameworks/{framework}/concepts/policy-packs
---
[DevTools](/docs/frameworks/next/dev-tools)
`
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
    });

    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "guides/overview.mdx",
          kind: "frontmatter",
          rule: "unresolved-placeholder",
        }),
        expect.objectContaining({
          file: "guides/overview.mdx",
          kind: "content",
          rule: "invalid-link",
        }),
      ])
    );
  });
});
