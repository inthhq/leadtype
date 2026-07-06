import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLintCommand } from "./cli";
import { lintConfigLinks } from "./config-lint";
import { collectRouteSet, lintDocs } from "./runner";

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
date: 2026-06-03
deprecated: Use /docs/guides/start instead.
tags: [guides]
group: get-started
search: false
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

describe("lintDocs GEO structure", () => {
  it("flags skipped headings, unlabeled code fences, and missing image alt", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "guide.mdx"),
      [
        "---",
        "title: Guide",
        "description: A guide.",
        "---",
        "",
        "## Section",
        "",
        "#### Skipped to H4",
        "",
        "```",
        "bare fence, no language",
        "```",
        "",
        "![](/diagram.png)",
        "",
        "Done.",
      ].join("\n")
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });
    const rules = new Set(
      result.violations
        .filter((v) => v.rule.startsWith("geo:"))
        .map((v) => v.rule)
    );
    expect(rules.has("geo:heading-skip")).toBe(true);
    expect(rules.has("geo:code-language")).toBe(true);
    expect(rules.has("geo:image-alt")).toBe(true);
    // GEO issues are warnings, never errors — they don't fail the build by default.
    expect(
      result.violations
        .filter((v) => v.rule.startsWith("geo:"))
        .every((v) => v.severity === "warn")
    ).toBe(true);
  });

  it("passes a well-structured page (sequential headings, labeled code, alt text)", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "clean.mdx"),
      [
        "---",
        "title: Clean",
        "description: A clean page.",
        "---",
        "",
        "## How do I install it?",
        "",
        "```bash",
        "npm install thing",
        "```",
        "",
        "### Details",
        "",
        "![Install flow: download then run](/flow.png)",
      ].join("\n")
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });
    expect(result.violations.some((v) => v.rule.startsWith("geo:"))).toBe(
      false
    );
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

describe("lintDocs mounts and rule overrides", () => {
  it("validates links under mount prefixes against mounted routes", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "changelog", "v1.mdx"),
      "---\ntitle: V1\n---\nBody\n"
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[latest](/changelog/v1) and [missing](/changelog/v2)\n"
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
      mounts: [{ pathPrefix: "changelog", urlPrefix: "/changelog" }],
    });

    const messages = result.violations.map((violation) => violation.message);
    expect(messages).toEqual([expect.stringContaining("/changelog/v2")]);
    expect(result.violations[0]?.rule).toBe("invalid-link");
  });

  it("flags stale /docs links to pages moved under a mount", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "changelog", "v1.mdx"),
      "---\ntitle: V1\n---\nBody\n"
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[old path](/docs/changelog/v1)\n"
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
      mounts: [{ pathPrefix: "changelog", urlPrefix: "/changelog" }],
    });

    expect(result.violations).toEqual([
      expect.objectContaining({
        rule: "invalid-link",
        message: expect.stringContaining("/docs/changelog/v1"),
      }),
    ]);
  });

  it("assumes links under generated prefixes are valid", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[API](/docs/rest-api/endpoints)\n"
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
      assumeValidLinkPrefixes: ["/docs/rest-api"],
    });

    expect(result.violations).toEqual([]);
  });

  it("applies rule severity overrides, including off", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[gone](/docs/missing)\n\n![](/img.png)\n"
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
      rules: { "invalid-link": "off", "geo:image-alt": "error" },
    });

    expect(
      result.violations.some((violation) => violation.rule === "invalid-link")
    ).toBe(false);
    const imageAlt = result.violations.find(
      (violation) => violation.rule === "geo:image-alt"
    );
    expect(imageAlt?.severity).toBe("error");
    expect(result.summary.errors).toBeGreaterThan(0);
  });
});

describe("lintDocs relative links and anchors", () => {
  it("resolves relative links against the source file", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "alpha.mdx"),
      "---\ntitle: Alpha\n---\n[sibling](./beta) and [up](../index.mdx) and [gone](./missing)\n"
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "beta.mdx"),
      "---\ntitle: Beta\n---\nBody\n"
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\nBody\n"
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });

    expect(result.violations).toEqual([
      expect.objectContaining({
        rule: "invalid-link",
        file: "guides/alpha.mdx",
        message: expect.stringContaining("/docs/guides/missing"),
      }),
    ]);
  });

  it("skips relative links to non-doc assets", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[spec](./api.pdf) and [page](./v0.4)\n"
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "v0.4.mdx"),
      "---\ntitle: V0.4\n---\nBody\n"
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });

    // ./api.pdf is an asset, not a route; ./v0.4 is a real dotted page name
    // and validates cleanly.
    expect(result.violations).toEqual([]);
  });

  it("flags relative links that climb out of the docs tree", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[escape](../outside)\n"
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });

    expect(result.violations).toEqual([
      expect.objectContaining({
        rule: "invalid-link",
        message: expect.stringContaining("outside the docs tree"),
      }),
    ]);
  });

  it("validates same-page and cross-page anchors", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      [
        "---",
        "title: Home",
        "---",
        "## Install",
        "",
        "[jump](#install) [bad-jump](#instal)",
        "",
        "[deep](/docs/guides/alpha#setup) [bad-deep](/docs/guides/alpha#set-up)",
        "",
      ].join("\n")
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "guides", "alpha.mdx"),
      "---\ntitle: Alpha\n---\n## Setup\n\nBody\n"
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });

    const anchors = result.violations.filter(
      (violation) => violation.rule === "invalid-anchor"
    );
    expect(anchors.map((violation) => violation.message)).toEqual([
      expect.stringContaining("#instal"),
      expect.stringContaining("#set-up"),
    ]);
    expect(result.violations).toHaveLength(2);
  });

  it("counts anchors contributed by include targets", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      '---\ntitle: Home\n---\n<include src="./_partials/shared.mdx" />\n\n[jump](#from-include)\n'
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "_partials", "shared.mdx"),
      "## From include\n\nBody\n"
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });

    expect(result.violations).toEqual([]);
  });

  it("suggests the new route when an invalid link matches a redirect", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[old](/docs/old-guide)\n"
    );

    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
      redirects: [
        { from: "/docs/old-guide", to: "/docs/new-guide", status: 308 },
      ],
    });

    expect(result.violations).toEqual([
      expect.objectContaining({
        rule: "invalid-link",
        message: expect.stringContaining("moved to `/docs/new-guide`"),
      }),
    ]);
  });
});

describe("lintDocs snippet parse checks", () => {
  async function lintSnippet(
    body: string
  ): Promise<Awaited<ReturnType<typeof lintDocs>>["violations"]> {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      `---\ntitle: Home\n---\n${body}`
    );
    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });
    return result.violations.filter(
      (violation) => violation.rule === "snippet:parse"
    );
  }

  it("flags a ts snippet that does not parse, with a line number", async () => {
    const violations = await lintSnippet(
      "Intro\n\n```ts\nconst ok = 1;\nconst broken = ;\n```\n"
    );
    expect(violations).toEqual([
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("line"),
      }),
    ]);
  });

  it("accepts common fragment idioms without annotations", async () => {
    const violations = await lintSnippet(
      [
        "```ts",
        "searchDocs(index: unknown, query: string): string[]",
        "listDocsContentFiles(index: unknown): string[]",
        "```",
        "",
        "```ts",
        "{",
        '  slug: "docs-site",',
        '  children: [{ slug: "x", title: "X" }],',
        "}",
        "```",
        "",
        "```ts",
        "{",
        "  markdown: string;",
        "  toc: string[];",
        "}",
        "```",
        "",
        "```ts",
        "collections: {",
        '  changelog: defineCollection({ dir: "./changelog" }),',
        "}",
        "```",
        "",
        "```tsx",
        '<CommandTabs command="leadtype" mode="install" />',
        '<CommandTabs command="leadtype lint" mode="run" />',
        "```",
        "",
        "```ts",
        "const config = {",
        "  // eslint-style comment",
        "  ...",
        "};",
        "```",
        "",
      ].join("\n")
    );
    expect(violations).toEqual([]);
  });

  it("honors the @noErrors escape hatch", async () => {
    const violations = await lintSnippet(
      "```ts\n// @noErrors — deliberate fragment\nconst broken = ;\n```\n"
    );
    expect(violations).toEqual([]);
  });

  it("checks json and yaml fences with docs-idiom tolerance", async () => {
    const violations = await lintSnippet(
      [
        "```json",
        "{",
        "  // a comment",
        '  "files": { /* stats */ },',
        '  "mode": "site",',
        "}",
        "```",
        "",
        "```yaml",
        "---",
        "a: 1",
        "---",
        "b: 2",
        "```",
        "",
        "```json",
        "{ not json",
        "```",
        "",
        "```yaml",
        "key: [unclosed",
        "```",
        "",
      ].join("\n")
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]?.message).toContain("json");
    expect(violations[1]?.message).toContain("yaml");
  });

  it("lints jsonc fences with comment tolerance", async () => {
    const violations = await lintSnippet(
      [
        "```jsonc",
        "{",
        "  // tolerated",
        '  "a": 1,',
        "}",
        "```",
        "",
        "```jsonc",
        "{ broken",
        "```",
        "",
      ].join("\n")
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("jsonc");
  });

  it("checks snippets contributed by include targets", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      '---\ntitle: Home\n---\n```ts\nconst ok = 1;\n```\n\n<include src="./_partials/broken.mdx" />\n'
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "_partials", "broken.mdx"),
      "```ts\nconst broken = ;\n```\n"
    );

    const result = await lintDocs({ srcDir: path.join(projectDir, "docs") });
    const snippets = result.violations.filter(
      (violation) => violation.rule === "snippet:parse"
    );

    // Exactly one violation: the include-contributed fence, attributed to the
    // including page; the directly-authored fence isn't double-reported.
    expect(snippets).toEqual([
      expect.objectContaining({
        file: "index.mdx",
        message: expect.stringContaining("from an included file"),
      }),
    ]);
  });

  it("can be disabled via rules overrides", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n```ts\nconst broken = ;\n```\n"
    );
    const result = await lintDocs({
      srcDir: path.join(projectDir, "docs"),
      rules: { "snippet:parse": "off" },
    });
    expect(result.violations).toEqual([]);
  });
});

describe("lintConfigLinks", () => {
  it("reports navigation entries that match no page", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\nBody\n"
    );
    const srcDir = path.join(projectDir, "docs");

    const violations = await lintConfigLinks({
      config: {
        product: { name: "T", tagline: "t" },
        navigation: ["index", "missing-page"],
      },
      configFile: "docs/docs.config.ts",
      srcDir,
      routeSet: await collectRouteSet({ srcDir }),
    });

    expect(violations).toEqual([
      expect.objectContaining({
        rule: "config-link",
        kind: "config",
        severity: "error",
        field: "navigation",
        message: expect.stringContaining("missing-page"),
      }),
    ]);
  });

  it("reports curated llms links, empty feeds, and live removed paths", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\nBody\n"
    );
    const srcDir = path.join(projectDir, "docs");

    const violations = await lintConfigLinks({
      config: {
        product: { name: "T", tagline: "t" },
        llms: {
          sections: [
            {
              type: "links",
              heading: "Start",
              links: [
                { urlPath: "/docs", title: "Home" },
                { urlPath: "/docs/gone", title: "Gone" },
              ],
            },
          ],
        },
        feeds: [
          {
            id: "changelog",
            title: "Changelog",
            source: { urlPrefix: "/changelog" },
            formats: ["rss"],
            output: { rss: "/changelog/rss.xml" },
          },
        ],
        redirects: { removed: ["/docs"] },
      },
      configFile: "docs/docs.config.ts",
      srcDir,
      routeSet: await collectRouteSet({ srcDir }),
    });

    const byField = new Map(
      violations.map((violation) => [violation.field, violation])
    );
    expect(byField.get("llms.sections[0]")?.severity).toBe("error");
    expect(byField.get("llms.sections[0]")?.message).toContain("/docs/gone");
    expect(byField.get("feeds[0]")?.severity).toBe("warn");
    expect(byField.get("redirects.removed")?.severity).toBe("warn");
    expect(violations).toHaveLength(3);
  });
});

describe("lintConfigLinks generated prefixes", () => {
  it("does not warn on feeds selecting from a generated tree", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\nBody\n"
    );
    const srcDir = path.join(projectDir, "docs");

    const violations = await lintConfigLinks({
      config: {
        product: { name: "T", tagline: "t" },
        feeds: [
          {
            id: "api",
            title: "API changes",
            source: { urlPrefix: "/docs/rest-api" },
            formats: ["rss"],
            output: { rss: "/rest-api/rss.xml" },
          },
        ],
      },
      configFile: "docs/docs.config.ts",
      srcDir,
      routeSet: await collectRouteSet({ srcDir }),
      assumeValidLinkPrefixes: ["/docs/rest-api"],
    });

    expect(violations).toEqual([]);
  });
});

describe("runLintCommand config discovery", () => {
  function createCapture(): {
    io: {
      stderr: { write(chunk: string): boolean };
      stdout: { write(chunk: string): boolean };
    };
    stderr(): string;
    stdout(): string;
  } {
    let stderrText = "";
    let stdoutText = "";
    return {
      io: {
        stderr: {
          write(chunk: string) {
            stderrText += chunk;
            return true;
          },
        },
        stdout: {
          write(chunk: string) {
            stdoutText += chunk;
            return true;
          },
        },
      },
      stderr: () => stderrText,
      stdout: () => stdoutText,
    };
  }

  it("discovers docs.config in --src, applies mounts and lint.rules", async () => {
    const projectDir = await createTempProject();
    const srcDir = path.join(projectDir, "docs");
    await writeProjectFile(
      projectDir,
      path.join("docs", "docs.config.ts"),
      `export default {
  product: { name: "T", tagline: "t" },
  navigation: ["index"],
  mounts: [{ pathPrefix: "changelog", urlPrefix: "/changelog" }],
  lint: { rules: { "geo:image-alt": "off" } },
};
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[v1](/changelog/v1)\n\n![](/img.png)\n"
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "changelog", "v1.mdx"),
      "---\ntitle: V1\n---\nBody\n"
    );

    const capture = createCapture();
    const code = await runLintCommand(
      ["--src", srcDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(0);
    const report = JSON.parse(capture.stdout()) as {
      violations: unknown[];
      summary: { errors: number; warnings: number };
    };
    expect(report.violations).toEqual([]);
  });

  it("fails at the config when curated navigation references a deleted page", async () => {
    const projectDir = await createTempProject();
    const srcDir = path.join(projectDir, "docs");
    await writeProjectFile(
      projectDir,
      path.join("docs", "docs.config.ts"),
      `export default {
  product: { name: "T", tagline: "t" },
  navigation: ["index", "deleted-page"],
};
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\nBody\n"
    );

    const capture = createCapture();
    const code = await runLintCommand(
      ["--src", srcDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(1);
    const report = JSON.parse(capture.stdout()) as {
      violations: { rule: string; file: string }[];
    };
    expect(report.violations).toEqual([
      expect.objectContaining({
        rule: "config-link",
        file: expect.stringContaining("docs.config.ts"),
      }),
    ]);
  });

  it("validates cross-collection links against every collection's routes", async () => {
    const projectDir = await createTempProject();
    await writeProjectFile(
      projectDir,
      "leadtype.config.ts",
      `export default {
  product: { name: "T", tagline: "t" },
  collections: {
    guides: { dir: "./guides" },
    changelog: { dir: "./changelog" },
  },
};
`
    );
    await writeProjectFile(
      projectDir,
      path.join("guides", "index.mdx"),
      "---\ntitle: Guides\n---\n[v1](/changelog/v1) and [missing](/changelog/v2)\n"
    );
    await writeProjectFile(
      projectDir,
      path.join("changelog", "v1.mdx"),
      "---\ntitle: V1\n---\nBody\n"
    );

    const capture = createCapture();
    const code = await runLintCommand(
      ["--src", projectDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(1);
    const report = JSON.parse(capture.stdout()) as {
      violations: { rule: string; message: string }[];
    };
    expect(report.violations).toEqual([
      expect.objectContaining({
        rule: "invalid-link",
        message: expect.stringContaining("/changelog/v2"),
      }),
    ]);
  });

  it("scopes the OpenAPI link exemption to the configured urlPrefix", async () => {
    const projectDir = await createTempProject();
    const srcDir = path.join(projectDir, "docs");
    await writeProjectFile(
      projectDir,
      path.join("docs", "docs.config.ts"),
      `export default {
  product: { name: "T", tagline: "t" },
  navigation: ["index"],
  openapi: { input: "./openapi/api.yaml", output: "rest-api", urlPrefix: "/reference" },
};
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[stale](/docs/rest-api/endpoints)\n"
    );

    const capture = createCapture();
    const code = await runLintCommand(
      ["--src", srcDir, "--format", "json"],
      capture.io
    );

    // With urlPrefix "/reference", generated pages live under
    // /reference/rest-api — the old /docs/rest-api path is a real broken link.
    expect(code).toBe(1);
    const report = JSON.parse(capture.stdout()) as {
      violations: { rule: string; message: string }[];
    };
    expect(report.violations).toEqual([
      expect.objectContaining({
        rule: "invalid-link",
        message: expect.stringContaining("/docs/rest-api/endpoints"),
      }),
    ]);
  });

  it("exempts generated OpenAPI links even when output has a leading slash", async () => {
    const projectDir = await createTempProject();
    const srcDir = path.join(projectDir, "docs");
    await writeProjectFile(
      projectDir,
      path.join("docs", "docs.config.ts"),
      `export default {
  product: { name: "T", tagline: "t" },
  navigation: ["index"],
  openapi: { input: "./openapi/api.yaml", output: "/rest-api" },
};
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\n[API](/docs/rest-api/endpoints)\n"
    );

    const capture = createCapture();
    const code = await runLintCommand(
      ["--src", srcDir, "--format", "json"],
      capture.io
    );

    // The generator strips the leading slash (routes live at
    // /docs/rest-api/...), so the exemption must match despite it.
    expect(code).toBe(0);
  });

  it("reports an invalid docs config instead of crashing", async () => {
    const projectDir = await createTempProject();
    const srcDir = path.join(projectDir, "docs");
    await writeProjectFile(
      projectDir,
      path.join("docs", "docs.config.ts"),
      'export default { lint: { rules: { "invalid-link": "sometimes" } }, product: { name: "T", tagline: "t" }, navigation: ["index"] };\n'
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "index.mdx"),
      "---\ntitle: Home\n---\nBody\n"
    );

    const capture = createCapture();
    const code = await runLintCommand(["--src", srcDir], capture.io);

    expect(code).toBe(1);
    expect(capture.stderr()).toContain("lint.rules.invalid-link");
  });
});
