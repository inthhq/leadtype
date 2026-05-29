import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertMdxToMarkdown } from "../convert";
import { defaultRemarkPlugins } from "./default-plugins";
import { defineComponentFlattener } from "./define-flattener";

const tempDirs: string[] = [];

async function createTempMdxFile(
  fileName: string,
  content: string
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-flattener-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, fileName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("defineComponentFlattener", () => {
  it("flattens a custom component via builders", async () => {
    const hint = defineComponentFlattener({
      name: "Hint",
      props: { title: "string" },
      toMarkdown: ({ props, content, b }) =>
        b.blockquote([`**${props.title}** ${content}`]),
    });

    const sourcePath = await createTempMdxFile(
      "page.mdx",
      '<Hint title="Heads up">Be careful here</Hint>\n'
    );

    const { markdown } = await convertMdxToMarkdown(sourcePath, [
      ...defaultRemarkPlugins,
      hint,
    ]);

    expect(markdown).toContain("> **Heads up** Be careful here");
  });

  it("coerces props per the declarative type map", async () => {
    const probe = defineComponentFlattener({
      name: "Probe",
      props: {
        label: "string",
        count: "number",
        open: "boolean",
        tags: "string[]",
      },
      toMarkdown: ({ props }) =>
        [
          `label=${props.label}`,
          `count=${props.count}`,
          `countType=${typeof props.count}`,
          `open=${props.open}`,
          `openType=${typeof props.open}`,
          `tags=${props.tags?.join(",")}`,
        ].join(" "),
    });

    const sourcePath = await createTempMdxFile(
      "page.mdx",
      '<Probe label="hi" count={3} open tags={["a", "b"]} />\n'
    );

    const { markdown } = await convertMdxToMarkdown(sourcePath, [
      ...defaultRemarkPlugins,
      probe,
    ]);

    expect(markdown).toContain("label=hi");
    expect(markdown).toContain("count=3");
    expect(markdown).toContain("countType=number");
    expect(markdown).toContain("open=true");
    expect(markdown).toContain("openType=boolean");
    expect(markdown).toContain("tags=a,b");
  });

  it("flattens built-in children into the content string", async () => {
    const wrap = defineComponentFlattener({
      name: "Wrap",
      toMarkdown: ({ content }) => `BEGIN\n\n${content}\n\nEND`,
    });

    const sourcePath = await createTempMdxFile(
      "page.mdx",
      `<Wrap>
  <Callout variant="warning">Be careful</Callout>
</Wrap>
`
    );

    const { markdown } = await convertMdxToMarkdown(sourcePath, [
      ...defaultRemarkPlugins,
      wrap,
    ]);

    expect(markdown).toContain("BEGIN");
    expect(markdown).toContain("Warning:");
    expect(markdown).toContain("Be careful");
    expect(markdown).toContain("END");
  });

  it("preserves block structure through childNodes", async () => {
    const panel = defineComponentFlattener({
      name: "Panel",
      toMarkdown: ({ childNodes, b }) => [b.heading(2, "Panel"), ...childNodes],
    });

    const sourcePath = await createTempMdxFile(
      "page.mdx",
      `<Panel>

| A | B |
| - | - |
| 1 | 2 |

</Panel>
`
    );

    const { markdown } = await convertMdxToMarkdown(sourcePath, [
      ...defaultRemarkPlugins,
      panel,
    ]);

    expect(markdown).toContain("## Panel");
    expect(markdown).toContain("|A|B|");
    expect(markdown).toContain("|1|2|");
  });

  it("composes when a built-in component wraps the custom one", async () => {
    const hint = defineComponentFlattener({
      name: "Hint",
      props: { title: "string" },
      toMarkdown: ({ props, content }) => `> **${props.title}** ${content}`,
    });

    const sourcePath = await createTempMdxFile(
      "page.mdx",
      `<Steps>
  <Step title="First">
    <Hint title="Tip">remember this</Hint>
  </Step>
</Steps>
`
    );

    const { markdown } = await convertMdxToMarkdown(sourcePath, [
      ...defaultRemarkPlugins,
      hint,
    ]);

    // The Hint flattened to a blockquote before Steps serialized its content.
    expect(markdown).toContain("remember this");
    expect(markdown).toContain("Tip");
    expect(markdown).toContain(">");
  });

  it("matches multiple names and exposes the raw node", async () => {
    const tagName = defineComponentFlattener({
      name: ["Foo", "Bar"],
      toMarkdown: ({ node }) => `[${node.name}]`,
    });

    const sourcePath = await createTempMdxFile(
      "page.mdx",
      "<Foo />\n\n<Bar />\n"
    );

    const { markdown } = await convertMdxToMarkdown(sourcePath, [
      ...defaultRemarkPlugins,
      tagName,
    ]);

    expect(markdown).toContain("[Foo]");
    expect(markdown).toContain("[Bar]");
  });

  it("removes the component when toMarkdown returns null", async () => {
    const drop = defineComponentFlattener({
      name: "Drop",
      toMarkdown: () => null,
    });

    const sourcePath = await createTempMdxFile(
      "page.mdx",
      "keep this\n\n<Drop>remove this</Drop>\n"
    );

    const { markdown } = await convertMdxToMarkdown(sourcePath, [
      ...defaultRemarkPlugins,
      drop,
    ]);

    expect(markdown).toContain("keep this");
    expect(markdown).not.toContain("remove this");
  });

  it("runs after the resolve phase so prop placeholders are resolved", async () => {
    const docLink = defineComponentFlattener({
      name: "DocLink",
      props: { href: "string" },
      toMarkdown: ({ props }) => `href:${props.href}`,
    });

    const sourcePath = await createTempMdxFile(
      path.join("docs", "frameworks", "svelte", "page.mdx"),
      '<DocLink href="/docs/frameworks/{framework}/api" />\n'
    );

    const { markdown } = await convertMdxToMarkdown(sourcePath, [
      ...defaultRemarkPlugins,
      docLink,
    ]);

    expect(markdown).toContain("href:/docs/frameworks/svelte/api");
  });

  it("leaves the raw component in place when toMarkdown throws", async () => {
    const boom = defineComponentFlattener({
      name: "Boom",
      toMarkdown: () => {
        throw new Error("nope");
      },
    });

    const sourcePath = await createTempMdxFile(
      "page.mdx",
      "before\n\n<Boom>untouched</Boom>\n\nafter\n"
    );

    const { markdown } = await convertMdxToMarkdown(sourcePath, [
      ...defaultRemarkPlugins,
      boom,
    ]);

    expect(markdown).toContain("before");
    expect(markdown).toContain("after");
    expect(markdown).toContain("<Boom>");
    expect(markdown).toContain("untouched");
  });
});
