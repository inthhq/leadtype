import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintDocs } from "./runner";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-lint-"));
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
variants:
  - value: next
    href: /docs/frameworks/{framework}/concepts/policy-packs
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
variants:
  - value: next
    href: /docs/frameworks/{framework}/concepts/policy-packs
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

  it("ignores _shared fragments by default", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "_shared", "fragments", "common.mdx"),
      `No frontmatter here on purpose.
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: Overview
---
Body
`
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
    });

    expect(result.summary.errors).toBe(0);
    expect(result.violations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "_shared/fragments/common.mdx",
        }),
      ])
    );
  });

  it("does not accept routes from ignored files", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: Overview
---
[Shared doc](/docs/shared/internal-only)
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "shared", "internal-only.mdx"),
      `---
title: Internal only
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
          file: "guides/overview.mdx",
          kind: "content",
          rule: "invalid-link",
        }),
      ])
    );
  });

  it("ignores placeholders in non-URL frontmatter fields", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: "Welcome to {framework}"
description: "Use {framework} to get started."
canonicalUrl: "/docs/guides/overview"
---
Body
`
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
    });

    expect(result.violations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "guides/overview.mdx",
          rule: "unresolved-placeholder",
        }),
      ])
    );
  });

  it("validates placeholders in canonicalUrl frontmatter fields", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: Overview
canonicalUrl: "/docs/frameworks/{framework}/overview"
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
          file: "guides/overview.mdx",
          kind: "frontmatter",
          rule: "unresolved-placeholder",
          field: "canonicalUrl",
        }),
      ])
    );
  });

  it("validates reference-style markdown links", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: Overview
---
[Quickstart][quickstart]

[quickstart]: /docs/guides/quickstart
`
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
    });

    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "guides/overview.mdx",
          kind: "content",
          rule: "invalid-link",
        }),
      ])
    );
    expect(
      result.violations.filter(
        (violation) =>
          violation.file === "guides/overview.mdx" &&
          violation.kind === "content" &&
          violation.rule === "invalid-link"
      )
    ).toHaveLength(1);
  });

  it("ignores placeholder-based external markdown links", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: Overview
---
[Spec]({baseUrl}/openapi.json)
[API](https://example/{version})
`
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
    });

    expect(result.violations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "guides/overview.mdx",
          kind: "content",
          rule: "unresolved-placeholder",
        }),
      ])
    );
  });
});

describe("lintDocs default frontmatter schema", () => {
  it("accepts editorial status, string deprecation, variants, and related links", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: Overview
description: Start here.
icon: book-open
status: updated
deprecated: Use /docs/guides/start instead.
tags: [guides]
group: get-started
order: 10
variants:
  - value: next
    label: Next.js
    href: /docs/guides/overview
    description: Next.js version.
related:
  - title: Start guide
    href: /docs/guides/overview
    description: Read this next.
full: true
---
Body
`
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
      unknownFieldSeverity: "error",
    });

    expect(result.summary.errors).toBe(0);
  });

  it("rejects release-channel page status and old lifecycle aliases", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: Overview
status: canary
deprecated: true
deprecatedReason: Use /docs/guides/start instead.
experimental: true
canary: true
new: true
draft: true
availableIn:
  - framework: next
    url: /docs/frameworks/{framework}/overview
---
Body
`
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
      unknownFieldSeverity: "error",
    });

    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "status",
          kind: "frontmatter",
          rule: "schema",
        }),
        expect.objectContaining({
          field: "deprecated",
          kind: "frontmatter",
          rule: "schema",
        }),
        expect.objectContaining({
          field: "deprecatedReason",
          kind: "frontmatter",
          rule: "unknown-field",
        }),
        expect.objectContaining({
          field: "experimental",
          kind: "frontmatter",
          rule: "unknown-field",
        }),
        expect.objectContaining({
          field: "canary",
          kind: "frontmatter",
          rule: "unknown-field",
        }),
        expect.objectContaining({
          field: "new",
          kind: "frontmatter",
          rule: "unknown-field",
        }),
        expect.objectContaining({
          field: "draft",
          kind: "frontmatter",
          rule: "unknown-field",
        }),
        expect.objectContaining({
          field: "availableIn",
          kind: "frontmatter",
          rule: "unknown-field",
        }),
      ])
    );
  });
});
