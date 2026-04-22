import { describe, expect, it } from "vitest";
import {
  createDocsBash,
  createDocsBashFileMap,
  createDocsSearchIndex,
  type DocsSearchDocument,
} from "./index";

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

describe("docs bash adapter", () => {
  it("creates a docs filesystem map", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const files = createDocsBashFileMap(index);

    expect(files["/docs/README.md"]).toContain("grep -ri");
    expect(files["/docs/llms.txt"]).toContain("Tabs");
    expect(files["/docs/components/tabs.md"]).toContain("CommandTabs");
    expect(files["/docs/.index/documents.json"]).toContain("components/tabs");
  });

  it("runs read-only docs commands", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const bash = createDocsBash(index);

    await expect(bash.exec("ls /docs/components")).resolves.toMatchObject({
      stdout: "tabs.md\n",
      exitCode: 0,
    });
    await expect(
      bash.exec("grep -ri CommandTabs /docs")
    ).resolves.toMatchObject({
      exitCode: 0,
    });
    await expect(
      bash.exec("cat /docs/components/tabs.md")
    ).resolves.toMatchObject({
      exitCode: 0,
    });
    await expect(bash.exec("find /docs -name '*.md'")).resolves.toMatchObject({
      exitCode: 0,
    });
  });

  it("keeps the filesystem read-only", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const bash = createDocsBash(index);

    await expect(
      bash.exec("echo changed > /docs/components/tabs.md")
    ).rejects.toThrow("read-only");
    await expect(bash.exec("cat /docs/components/tabs.md")).resolves.toEqual(
      expect.objectContaining({
        stdout: expect.stringContaining("CommandTabs"),
      })
    );
  });
});
