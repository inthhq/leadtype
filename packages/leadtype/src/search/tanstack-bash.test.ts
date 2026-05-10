import { describe, expect, it } from "vitest";
import { createDocsSearchIndex, type DocsSearchDocument } from "./index";
import { createDocsBashTools } from "./tanstack-bash";

const docs: DocsSearchDocument[] = [
  {
    id: "components/tabs",
    title: "Tabs",
    description: "Interactive tabs.",
    urlPath: "/docs/components/tabs",
    absoluteUrl: "https://leadtype.dev/docs/components/tabs",
    relativePath: "components/tabs",
    content: "# Tabs\n\n## CommandTabs\n\nUse tabs to switch package managers.",
  },
];

describe("TanStack docs bash tools", () => {
  it("executes read-only docs bash commands", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = createDocsBashTools(index);
    const bashTool = result.tools.find((tool) => tool.name === "docs_bash");

    expect(result.instructions).toContain("Use bash only to inspect");
    await expect(
      bashTool?.execute?.({ command: "grep -ri CommandTabs /docs" })
    ).resolves.toMatchObject({
      exitCode: 0,
    });
  });

  it("reads exact docs files", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = createDocsBashTools(index);
    const readFileTool = result.tools.find(
      (tool) => tool.name === "docs_read_file"
    );

    expect(
      readFileTool?.execute?.({ path: "/docs/components/tabs.md" })
    ).toMatchObject({
      content: expect.stringContaining("CommandTabs"),
      path: "/docs/components/tabs.md",
    });
  });

  it("marks missing docs files", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = createDocsBashTools(index);
    const readFileTool = result.tools.find(
      (tool) => tool.name === "docs_read_file"
    );

    expect(
      readFileTool?.execute?.({ path: "/docs/components/missing.md" })
    ).toMatchObject({
      content: "",
      notFound: true,
      path: "/docs/components/missing.md",
    });
  });

  it("blocks unsafe write commands", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = createDocsBashTools(index);
    const bashTool = result.tools.find((tool) => tool.name === "docs_bash");

    await expect(
      bashTool?.execute?.({
        command: "echo changed > /docs/components/tabs.md",
      })
    ).resolves.toMatchObject({
      exitCode: 1,
      stdout: "Blocked unsafe docs bash command.\n",
    });
  });
});
