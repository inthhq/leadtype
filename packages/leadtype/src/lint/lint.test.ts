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

  it("rejects empty deprecated messages", async () => {
    const projectDir = await createTempProject();

    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "overview.mdx"),
      `---
title: Overview
deprecated: ""
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
          field: "deprecated",
          kind: "frontmatter",
          message: "deprecated: must not be empty",
          rule: "schema",
        }),
      ])
    );
  });
});

describe("lintDocs unflattened-component", () => {
  it("warns on rendered components with no flattener but not on code-block examples", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "guide.mdx"),
      `---
title: Guide
---

This renders for real and has no flattener:

<DangerWidget />

But these are only examples in a fence and must NOT warn:

\`\`\`tsx
<ConsentBanner />
<DangerWidget />
\`\`\`

Inline \`<AlsoFine />\` must not warn either.
`
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });
    const unflattened = result.violations.filter(
      (violation) => violation.rule === "unflattened-component"
    );

    expect(unflattened).toHaveLength(1);
    expect(unflattened[0]?.message).toContain("<DangerWidget>");
    expect(unflattened[0]?.message).toContain("line 7");
    expect(unflattened.some((v) => v.message.includes("ConsentBanner"))).toBe(
      false
    );
    expect(unflattened.some((v) => v.message.includes("AlsoFine"))).toBe(false);
  });

  it("does not warn on built-in contract components", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "builtin.mdx"),
      `---
title: Builtin
---

<Callout title="Heads up">Be careful.</Callout>

<Tabs items={["npm", "pnpm"]}>
  <Tab value="npm">npm i x</Tab>
  <Tab value="pnpm">pnpm add x</Tab>
</Tabs>
`
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });
    expect(
      result.violations.some((v) => v.rule === "unflattened-component")
    ).toBe(false);
  });

  it("treats knownComponents as recognized", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "custom.mdx"),
      `---
title: Custom
---

<Hint>Use a flattener.</Hint>
`
    );

    const withoutKnown = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
    });
    expect(
      withoutKnown.violations.some((v) => v.rule === "unflattened-component")
    ).toBe(true);

    const withKnown = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
      knownComponents: ["Hint"],
    });
    expect(
      withKnown.violations.some((v) => v.rule === "unflattened-component")
    ).toBe(false);
  });
});

describe("lintDocs JSON-LD validity", () => {
  it("flags a malformed date that would emit invalid JSON-LD", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "quickstart.mdx"),
      "---\ntitle: Quickstart\ndescription: Start here.\nlastModified: not-a-date\n---\nBody\n"
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });
    const jsonLd = result.violations.filter((v) => v.rule === "jsonld");
    expect(jsonLd).toHaveLength(1);
    expect(jsonLd[0].message).toContain("dateModified");
  });

  it("accepts a valid ISO date", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "quickstart.mdx"),
      "---\ntitle: Quickstart\ndescription: Start here.\nlastModified: 2026-05-01T00:00:00.000Z\n---\nBody\n"
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });
    expect(result.violations.some((v) => v.rule === "jsonld")).toBe(false);
  });
});
