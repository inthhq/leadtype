import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertMdxToMarkdown } from "../convert";
import {
  defaultRemarkPlugins,
  remarkInclude,
  remarkTypeTableToMarkdown,
} from "./index";

const tempDirs: string[] = [];

async function createTempMdxFile(
  fileName: string,
  content: string
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-remark-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, fileName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-remark-project-"));
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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain(
      "1. **Verify it works** Start your development server and confirm:"
    );
    expect(result.markdown).toContain("1. A **consent banner** appears");
    expect(result.markdown).toContain(
      '2. Clicking **"Customize"** opens a dialog'
    );
    expect(result.markdown).not.toContain('appearsClicking **"Customize"**');
  });

  it("resolves ExtractedTypeTable paths from docs by default", async () => {
    const projectDir = await createTempProject();
    const previousCwd = process.cwd();
    try {
      await writeProjectFile(
        projectDir,
        "docs/types.ts",
        `export interface PipelineOptions {
  /** Source directory for docs. */
  srcDir: string;
}`
      );
      const sourcePath = await writeProjectFile(
        projectDir,
        "docs/reference.mdx",
        '<ExtractedTypeTable name="PipelineOptions" path="./types.ts" />'
      );

      process.chdir(projectDir);
      const result = await convertMdxToMarkdown(sourcePath, [
        [remarkTypeTableToMarkdown, {}],
      ]);

      expect(result.markdown).toContain("srcDir");
      expect(result.markdown).toContain("Source directory for docs.");
    } finally {
      process.chdir(previousCwd);
    }
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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

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

    const result = await convertMdxToMarkdown(sourcePath, [
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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("url: /docs/frameworks/next/quickstart");
  });

  it("keeps accordion content in markdown output", async () => {
    const sourcePath = await createTempMdxFile(
      "faq.mdx",
      `<Accordion>
  <AccordionItem title="Can agents read this?">
    Yes. Closed content is still converted.
  </AccordionItem>
</Accordion>
`
    );

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("**Can agents read this?**");
    expect(result.markdown).toContain(
      "Yes. Closed content is still converted."
    );
  });

  it("converts examples with preview content and fenced code", async () => {
    const sourcePath = await createTempMdxFile(
      "example.mdx",
      `<Example
  title="Render MDX"
  description="Preview the output and inspect the source."
  filename="mdx-components.tsx"
  language="tsx"
  code={\`import { mdxComponents } from "@/components/docs-mdx";

export const components = {
  ...mdxComponents,
};\`}
>
  Preview content survives conversion.
</Example>
`
    );

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("**Render MDX**");
    expect(result.markdown).toContain("Preview content survives conversion.");
    expect(result.markdown).toContain("**mdx-components.tsx**");
    expect(result.markdown).toContain("```tsx");
    expect(result.markdown).toContain(
      'import { mdxComponents } from "@/components/docs-mdx";'
    );
  });

  it("keeps example source files authored with template literals", async () => {
    const sourcePath = await createTempMdxFile(
      "example-source-files.mdx",
      `<Example
  title="With source files"
  filename="main.tsx"
  language="tsx"
  code={\`export const main = true;\`}
  sourceFiles={[
    {
      filename: "support.ts",
      language: "ts",
      code: \`export const message = "support";

export const enabled = true;\`,
    },
  ]}
>
  Preview.
</Example>
`
    );

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("**support.ts**");
    expect(result.markdown).toContain("```ts");
    expect(result.markdown).toContain('export const message = "support";');
    expect(result.markdown).toContain("export const enabled = true;");
  });

  it("converts topic switchers to markdown links", async () => {
    const sourcePath = await createTempMdxFile(
      "topics.mdx",
      `<TopicSwitcher
  label="Framework"
  activeValue="react"
  items={[
    {
      value: "react",
      label: "React",
      href: "/docs/frameworks/react/quickstart",
      description: "React integration",
    },
    {
      value: "vue",
      label: "Vue",
      href: "/docs/frameworks/vue/quickstart",
      description: "Vue integration",
    },
  ]}
/>
`
    );

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("Framework");
    expect(result.markdown).toContain(
      "[React](/docs/frameworks/react/quickstart) — React integration"
    );
    expect(result.markdown).toContain(
      "[Vue](/docs/frameworks/vue/quickstart) — Vue integration"
    );
  });

  it("converts prompts to explicit prompt code blocks", async () => {
    const sourcePath = await createTempMdxFile(
      "prompt.mdx",
      `<Prompt
  title="Use this with your coding agent"
  description="Copy this into an agent session."
>
You are helping wire leadtype into a docs site.

- Read \`docs/docs.config.ts\` first.
- Place markdown negotiation before the HTML docs route.
</Prompt>
`
    );

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("**Use this with your coding agent**");
    expect(result.markdown).toContain("Copy this into an agent session.");
    expect(result.markdown).toContain("```prompt");
    expect(result.markdown).toContain(
      "You are helping wire leadtype into a docs site."
    );
    expect(result.markdown).toContain("- Read `docs/docs.config.ts` first.");
    expect(result.markdown).toContain(
      "- Place markdown negotiation before the HTML docs route."
    );
  });

  it("keeps agent audience content and removes human audience content", async () => {
    const sourcePath = await createTempMdxFile(
      "audience.mdx",
      `<Audience target="human">
  Click the robot icon in the example app header.
</Audience>

<Audience target="agent">
  Read \`public/docs/agent-readability.json\` before editing middleware.
</Audience>

<Audience target={'human'}>
  This JSX string expression is human-only.
</Audience>

<Audience target={"agent"}>
  This JSX string expression is agent-readable.
</Audience>
`
    );

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).not.toContain("Click the robot icon");
    expect(result.markdown).not.toContain(
      "This JSX string expression is human-only."
    );
    expect(result.markdown).not.toContain("<Audience");
    expect(result.markdown).toContain(
      "Read `public/docs/agent-readability.json` before editing middleware."
    );
    expect(result.markdown).toContain(
      "This JSX string expression is agent-readable."
    );
  });

  it("converts file trees to stable text fences", async () => {
    const sourcePath = await createTempMdxFile(
      "file-tree.mdx",
      `<FileTree root="public">
  <File name="llms.txt" />
  <Folder name="docs">
    <File name="index.md" />
    <Folder name="llms-full">
      <File name="get-started.txt" />
    </Folder>
  </Folder>
</FileTree>
`
    );

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("```text");
    expect(result.markdown).toContain("public/");
    expect(result.markdown).toContain("├── llms.txt");
    expect(result.markdown).toContain("└── docs/");
    expect(result.markdown).toContain("    ├── index.md");
    expect(result.markdown).toContain("    └── llms-full/");
    expect(result.markdown).toContain("        └── get-started.txt");
  });

  it("resolves framework placeholders inside topic switcher item hrefs", async () => {
    const sourcePath = await createTempMdxFile(
      path.join("docs", "frameworks", "next", "quickstart.mdx"),
      `<TopicSwitcher
  label="Framework"
  activeValue="next"
  items={[
    {
      value: "current",
      label: "Current framework",
      href: "/docs/frameworks/{framework}/quickstart",
      description: "The current route context",
    },
  ]}
/>
`
    );

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain(
      "[Current framework](/docs/frameworks/next/quickstart)"
    );
  });

  it("continues visiting siblings after removing an empty topic switcher", async () => {
    const sourcePath = await createTempMdxFile(
      "empty-topic-switcher.mdx",
      `<TopicSwitcher items={[]} />

<TopicSwitcher
  label="Framework"
  items={[
    {
      value: "react",
      label: "React",
      href: "/docs/frameworks/react/quickstart",
    },
  ]}
/>
`
    );

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain(
      "[React](/docs/frameworks/react/quickstart)"
    );
  });

  it("includes new component plugins in the default remark pipeline", () => {
    const pluginNames = defaultRemarkPlugins.map((plugin) => plugin.name);

    expect(pluginNames).toContain("remarkAccordionToMarkdown");
    expect(pluginNames).toContain("remarkAudienceToMarkdown");
    expect(pluginNames).toContain("remarkExampleToMarkdown");
    expect(pluginNames).toContain("remarkFileTreeToMarkdown");
    expect(pluginNames).toContain("remarkPromptToMarkdown");
    expect(pluginNames).toContain("remarkTopicSwitcherToMarkdown");
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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

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

    const result = await convertMdxToMarkdown(sourcePath, defaultRemarkPlugins);

    expect(result.markdown).toContain("Anchor body.");
    expect(result.markdown).not.toContain('id="types"');
    expect(result.markdown).not.toContain("anchor");
    expect(result.markdown).not.toContain("<section");
  });
});
