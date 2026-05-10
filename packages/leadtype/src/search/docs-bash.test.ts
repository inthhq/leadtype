import type { CommandName } from "just-bash";
import { describe, expect, it } from "vitest";
import {
  blockUnsafeDocsBashCommand,
  createDocsBash,
  createDocsBashFileMap,
} from "./docs-bash";
import { createDocsSearchIndex, type DocsSearchDocument } from "./index";

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

  it("blocks unsafe commands before custom command execution", () => {
    expect(blockUnsafeDocsBashCommand("tee /docs/components/tabs.md")).toBe(
      "printf 'Blocked unsafe docs bash command.\\n' && false"
    );
  });

  it("rejects custom commands outside the read-only allowlist", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(() =>
      createDocsBash(index, undefined, {
        commands: ["cat", "node" as CommandName],
      })
    ).toThrow("Unsupported docs bash commands: node");
  });
});
