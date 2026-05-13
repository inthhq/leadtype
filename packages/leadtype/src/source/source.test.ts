import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocsSource } from "./index";

async function writeMdx(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

describe("createDocsSource", () => {
  let contentDir: string;

  beforeEach(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "leadtype-source-"));
  });

  afterEach(async () => {
    await rm(contentDir, { force: true, recursive: true });
  });

  it("lists every .md / .mdx page under contentDir with stable slug derivation", async () => {
    await writeMdx(
      path.join(contentDir, "quickstart.mdx"),
      "---\ntitle: Quickstart\n---\nBody.\n"
    );
    await writeMdx(
      path.join(contentDir, "guides/setup.md"),
      "---\ntitle: Setup\n---\nBody.\n"
    );
    await writeMdx(
      path.join(contentDir, "guides/index.mdx"),
      "---\ntitle: Guides\n---\nBody.\n"
    );

    const source = await createDocsSource({ contentDir });
    const pages = await source.listPages();

    const slugs = pages.map((page) => page.slug.join("/")).sort();
    expect(slugs).toEqual(["guides", "guides/setup", "quickstart"]);

    const quickstart = pages.find((p) => p.slug.join("/") === "quickstart");
    expect(quickstart).toMatchObject({
      title: "Quickstart",
      extension: ".mdx",
    });
    expect(quickstart?.filePath).toMatch(/quickstart\.mdx$/);
  });

  it("loadPage returns parsed frontmatter, ast, markdown, and toc", async () => {
    await writeMdx(
      path.join(contentDir, "quickstart.mdx"),
      "---\ntitle: Quickstart\ndescription: Get started\n---\n\n## Install\n\nRun the command.\n"
    );

    const source = await createDocsSource({
      contentDir,
      baseUrl: "https://example.com",
    });
    const page = await source.loadPage("quickstart");

    expect(page).not.toBeNull();
    expect(page?.frontmatter).toMatchObject({
      title: "Quickstart",
      description: "Get started",
    });
    expect(page?.ast.type).toBe("root");
    expect(page?.markdown).toContain("## Install");
    expect(page?.toc.map((item) => item.title)).toEqual(["Install"]);
  });

  it("loadPage accepts both string and string[] slug forms", async () => {
    await writeMdx(
      path.join(contentDir, "guides/setup.mdx"),
      "---\ntitle: Setup\n---\nBody.\n"
    );

    const source = await createDocsSource({ contentDir });
    const byString = await source.loadPage("guides/setup");
    const byArray = await source.loadPage(["guides", "setup"]);

    expect(byString?.slug).toEqual(["guides", "setup"]);
    expect(byArray?.slug).toEqual(["guides", "setup"]);
    expect(byString?.title).toBe(byArray?.title);
  });

  it("loadPage returns null when no slug matches", async () => {
    await writeMdx(path.join(contentDir, "quickstart.mdx"), "# Q\n");

    const source = await createDocsSource({ contentDir });
    const missing = await source.loadPage("nope");
    expect(missing).toBeNull();
  });

  it("expands <include> references via the default source preset", async () => {
    await writeMdx(
      path.join(contentDir, "shared/install.mdx"),
      "## Install\n\nRun `bun add leadtype`.\n"
    );
    await writeMdx(
      path.join(contentDir, "quickstart.mdx"),
      '---\ntitle: Quickstart\n---\n\nIntro.\n\n<include src="./shared/install.mdx" />\n'
    );

    const source = await createDocsSource({ contentDir });
    const page = await source.loadPage("quickstart");

    expect(page?.markdown).toContain("## Install");
    expect(page?.markdown).toContain("bun add leadtype");
  });

  it("buildSearchIndex emits an index whose document ids match urlPaths", async () => {
    await writeMdx(
      path.join(contentDir, "quickstart.mdx"),
      "---\ntitle: Quickstart\n---\nBody one.\n"
    );
    await writeMdx(
      path.join(contentDir, "guides/setup.mdx"),
      "---\ntitle: Setup\n---\nBody two.\n"
    );

    const source = await createDocsSource({
      contentDir,
      baseUrl: "https://example.com",
    });
    const bundle = await source.buildSearchIndex();

    expect(bundle.index.documents.length).toBe(2);
    const documentIds = bundle.index.documents.map(([id]) => id).sort();
    expect(documentIds).toEqual(["/docs/guides/setup", "/docs/quickstart"]);
  });

  it("getNavigation routes pages into declared groups", async () => {
    await writeMdx(
      path.join(contentDir, "guides/setup.mdx"),
      "---\ntitle: Setup\ngroup: get-started\n---\nBody.\n"
    );
    await writeMdx(
      path.join(contentDir, "quickstart.mdx"),
      "---\ntitle: Quickstart\ngroup: get-started\n---\nBody.\n"
    );

    const source = await createDocsSource({
      contentDir,
      groups: [{ slug: "get-started", title: "Get Started" }],
    });
    const navigation = await source.getNavigation();

    expect(navigation.groups).toHaveLength(1);
    expect(navigation.groups[0]?.pages.map((p) => p.title).sort()).toEqual([
      "Quickstart",
      "Setup",
    ]);
  });

  it("resolveInclude defaults the fromDir to contentDir", async () => {
    await writeMdx(
      path.join(contentDir, "shared/install.mdx"),
      "## Install\n\nDo the thing.\n"
    );

    const source = await createDocsSource({ contentDir });
    const result = await source.resolveInclude("shared/install.mdx");

    expect(result.kind).toBe("markdown");
    if (result.kind === "markdown") {
      expect(result.content).toContain("Do the thing.");
    }
  });

  it("throws if contentDir does not exist", async () => {
    await expect(
      createDocsSource({ contentDir: path.join(contentDir, "does-not-exist") })
    ).rejects.toThrow(/does not exist/);
  });
});
