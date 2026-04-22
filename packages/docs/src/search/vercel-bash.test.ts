import { describe, expect, it } from "vitest";
import { createDocsBashTool as createLegacyDocsBashTool } from "./bash-index";
import { createDocsSearchIndex, type DocsSearchDocument } from "./index";
import { createDocsBashTool } from "./vercel-index";

const docs: DocsSearchDocument[] = [
  {
    id: "components/tabs",
    title: "Tabs",
    description: "Interactive tabs.",
    urlPath: "/docs/components/tabs",
    absoluteUrl: "https://docs.example.com/docs/components/tabs",
    relativePath: "components/tabs",
    content: "# Tabs\n\n## CommandTabs\n\nUse tabs to switch package managers.",
  },
];

describe("Vercel docs bash tool", () => {
  it("keeps the legacy bash alias compatible", () => {
    expect(createLegacyDocsBashTool).toBe(createDocsBashTool);
  });

  it("creates a bash-tool wrapper without writeFile by default", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = await createDocsBashTool(index);

    expect(result.instructions).toContain("Use bash only to inspect");
    expect(result.tools.bash).toBeDefined();
    expect(result.tools.readFile).toBeDefined();
    expect(result.tools.writeFile).toBeUndefined();
  });

  it("blocks unsafe commands before bash-tool execution", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = await createDocsBashTool(index);

    await expect(
      result.tools.bash.execute(
        { command: "echo changed > /docs/components/tabs.md" },
        { toolCallId: "write-redirect", messages: [] }
      )
    ).resolves.toMatchObject({
      stdout: "Blocked unsafe docs bash command.\n",
      exitCode: 1,
    });
    await expect(
      result.tools.bash.execute(
        { command: "sed -i 's/Tabs/Changed/' /docs/components/tabs.md" },
        { toolCallId: "sed-in-place", messages: [] }
      )
    ).resolves.toMatchObject({
      stdout: "Blocked unsafe docs bash command.\n",
      exitCode: 1,
    });
  });
});
