import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertMdxFile } from "../convert";
import { defaultRemarkPlugins, remarkInclude } from "./index";

const tempDirs: string[] = [];

async function createTempMdxFile(
  fileName: string,
  content: string
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "inth-docs-remark-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, fileName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "inth-docs-remark-project-"));
  tempDirs.push(dir);
  return dir;
}

async function writeProjectFile(
  rootDir: string,
  fileName: string,
  content: string
): Promise<string> {
  const filePath = path.join(rootDir, fileName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

describe("remark markdown output", () => {
  it("preserves nested lists inside Steps content", async () => {
    const sourcePath = await createTempMdxFile(
      "quickstart.mdx",
      `<Steps>
  <Step>
    ### Verify it works

    Start your development server and confirm:

    1. A **consent banner** appears
    2. Clicking **"Customize"** opens a dialog
  </Step>
</Steps>
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain(
      "1. **Verify it works** Start your development server and confirm:"
    );
    expect(result.markdown).toContain("1. A **consent banner** appears");
    expect(result.markdown).toContain(
      '2. Clicking **"Customize"** opens a dialog'
    );
    expect(result.markdown).not.toContain('appearsClicking **"Customize"**');
  });

  it("converts card grids with interactive cards into markdown lists", async () => {
    const sourcePath = await createTempMdxFile(
      "index.mdx",
      `<Cards>
  <Card
    variant="interactive"
    title="React"
    description="React quickstart."
    href="/docs/frameworks/react/quickstart"
  />
  <Card
    title="Next.js"
    description="Next.js quickstart."
    href="/docs/frameworks/next/quickstart"
  />
</Cards>
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain(
      "[React](/docs/frameworks/react/quickstart)"
    );
    expect(result.markdown).toContain(
      "[Next.js](/docs/frameworks/next/quickstart)"
    );
  });

  it("supports c15t callout aliases for warn and note", async () => {
    const sourcePath = await createTempMdxFile(
      "callouts.mdx",
      `<Callout type="warn">Be careful.</Callout>

<Callout type="note">Background detail.</Callout>
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("> ⚠️ **Warning:**");
    expect(result.markdown).toContain("> 📝 **Note:**");
    expect(result.markdown).toContain("Be careful.");
    expect(result.markdown).toContain("Background detail.");
  });

  it("synthesizes section titles for index files", async () => {
    const sourcePath = await createTempMdxFile(
      path.join("frameworks", "index.mdx"),
      `<Cards>
  <Card title="React" href="/docs/frameworks/react/quickstart" />
</Cards>
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("title: Frameworks");
  });

  it("resolves framework placeholders from included shared content", async () => {
    const projectDir = await createTempProject();
    const sourcePath = await writeProjectFile(
      projectDir,
      path.join("docs", "frameworks", "next", "concepts", "overview.mdx"),
      `<import src="../../../shared/concepts/common.mdx" />
`
    );
    await writeProjectFile(
      projectDir,
      path.join("docs", "shared", "concepts", "common.mdx"),
      `[Policy Packs](/docs/frameworks/{framework:react}/concepts/policy-packs)
`
    );

    const result = await convertMdxFile(sourcePath, [
      remarkInclude,
      ...defaultRemarkPlugins,
    ]);

    expect(result.markdown).toContain(
      "[Policy Packs](/docs/frameworks/next/concepts/policy-packs)"
    );
  });

  it("resolves frontmatter placeholders using the current framework", async () => {
    const sourcePath = await createTempMdxFile(
      path.join("docs", "frameworks", "next", "quickstart.mdx"),
      `---
title: Quickstart
availableIn:
  - framework: next
    url: /docs/frameworks/{framework}/quickstart
---
Body
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("url: /docs/frameworks/next/quickstart");
  });

  it("preserves non-plain frontmatter values while resolving placeholders", async () => {
    const sourcePath = await createTempMdxFile(
      path.join("docs", "frameworks", "next", "quickstart.mdx"),
      `---
title: Quickstart
publishedAt: 2026-04-19
url: /docs/frameworks/{framework}/quickstart
---
Body
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("publishedAt: 2026-04-19T00:00:00.000Z");
    expect(result.markdown).toContain("url: /docs/frameworks/next/quickstart");
  });

  it("removes JSX comments, unwraps sections, and flattens details blocks", async () => {
    const sourcePath = await createTempMdxFile(
      path.join("shared", "overview.mdx"),
      `{/* This file is NOT rendered directly. */}

<section id="types">
  Intro copy.

  <details>
    <summary>\`ConsentState\`</summary>

    More detail here.
  </details>
</section>
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("description: Intro copy.");
    expect(result.markdown).toContain("Intro copy.");
    expect(result.markdown).toContain("### ConsentState");
    expect(result.markdown).toContain("More detail here.");
    expect(result.markdown).not.toContain("{/*");
    expect(result.markdown).not.toContain("<section");
    expect(result.markdown).not.toContain("<details>");
    expect(result.markdown).not.toContain("<summary>");
  });

  it("falls back to a generic heading when <details> has no <summary>", async () => {
    const sourcePath = await createTempMdxFile(
      "details-no-summary.mdx",
      `<details>
  Body without a summary.
</details>
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("### Details");
    expect(result.markdown).toContain("Body without a summary.");
    expect(result.markdown).not.toContain("<details>");
  });

  it("extracts a <summary> that MDX parses inside a paragraph wrapper", async () => {
    // When <summary>...</summary> is followed by a blank line, MDX wraps the
    // JSX element in a paragraph. The plugin needs to unwrap that.
    const sourcePath = await createTempMdxFile(
      "details-paragraph-summary.mdx",
      `<details>
  <summary>Wrapped Summary</summary>

  Body text.
</details>
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("### Wrapped Summary");
    expect(result.markdown).toContain("Body text.");
  });

  it("removes adjacent JSX comments in a single pass", async () => {
    const sourcePath = await createTempMdxFile(
      "adjacent-comments.mdx",
      `{/* first */}
{/* second */}
{/* third */}

Body copy.
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).not.toContain("first");
    expect(result.markdown).not.toContain("second");
    expect(result.markdown).not.toContain("third");
    expect(result.markdown).not.toContain("{/*");
    expect(result.markdown).toContain("Body copy.");
  });

  it("unwraps nested <section> blocks (regression for visit() splice resume)", async () => {
    const sourcePath = await createTempMdxFile(
      "nested-sections.mdx",
      `<section id="outer">
  Outer copy.

  <section id="inner">
    Inner copy.
  </section>
</section>
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("Outer copy.");
    expect(result.markdown).toContain("Inner copy.");
    expect(result.markdown).not.toContain("<section");
  });

  it("drops <section> attributes silently (id is not preserved)", async () => {
    const sourcePath = await createTempMdxFile(
      "section-with-id.mdx",
      `<section id="types" className="anchor">
  Anchor body.
</section>
`
    );

    const result = await convertMdxFile(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("Anchor body.");
    expect(result.markdown).not.toContain('id="types"');
    expect(result.markdown).not.toContain("anchor");
    expect(result.markdown).not.toContain("<section");
  });
});
