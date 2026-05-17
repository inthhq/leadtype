import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as v from "valibot";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocsSource } from "./index";

async function writeMdx(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

describe("createDocsSource", () => {
  let contentDir: string;
  const extraTempDirs: string[] = [];

  beforeEach(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "leadtype-source-"));
  });

  afterEach(async () => {
    await Promise.all(
      [contentDir, ...extraTempDirs.splice(0)].map(async (dir) => {
        await rm(dir, { force: true, recursive: true });
      })
    );
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

  it("exposes custom transformed frontmatter on listPages and loadPage", async () => {
    await writeMdx(
      path.join(contentDir, "api/auth.mdx"),
      "---\ntitle: Auth\n---\n\n## Login\n\nUse sessions.\n"
    );

    const source = await createDocsSource({
      contentDir,
      frontmatterSchema: v.object({
        title: v.string(),
        apiArea: v.string(),
      }),
      transformers: [
        {
          name: "api-area",
          afterFrontmatter(page) {
            return {
              ...page,
              data: {
                ...page.data,
                apiArea: page.filePath.includes("/api/") ? "api" : "guides",
              },
            };
          },
        },
      ],
    });

    const [meta] = await source.listPages();
    const page = await source.loadPage("api/auth");

    expect(meta?.frontmatter.apiArea).toBe("api");
    expect(page?.frontmatter.apiArea).toBe("api");
  });

  it("validates synthesized frontmatter through custom source schemas", async () => {
    await writeMdx(
      path.join(contentDir, "untitled.mdx"),
      "# Synthesized Title\n\nIntro paragraph.\n"
    );

    const source = await createDocsSource({
      contentDir,
      frontmatterSchema: v.object({
        title: v.string(),
      }),
    });

    const [meta] = await source.listPages();
    const page = await source.loadPage("untitled");

    expect(meta?.frontmatter.title).toBe("Synthesized Title");
    expect(page?.frontmatter.title).toBe("Synthesized Title");
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

  it("resolves AutoTypeTable paths from the source root by default", async () => {
    const sourceRoot = await mkdtemp(
      path.join(tmpdir(), "leadtype-source-root-")
    );
    extraTempDirs.push(sourceRoot);
    await rm(contentDir, { force: true, recursive: true });
    contentDir = path.join(sourceRoot, "docs");
    await writeMdx(
      path.join(
        sourceRoot,
        "packages/react/src/components/consent-banner/consent-banner.tsx"
      ),
      `export interface ConsentBannerProps {
  /** Banner title shown above consent choices. */
  title?: string;
}
`
    );
    await writeMdx(
      path.join(contentDir, "reference.mdx"),
      '<AutoTypeTable name="ConsentBannerProps" path="./packages/react/src/components/consent-banner/consent-banner.tsx" />'
    );

    const source = await createDocsSource({ contentDir });
    const page = await source.loadPage("reference");

    expect(page?.markdown).toContain("title");
    expect(page?.markdown).toContain(
      "Banner title shown above consent choices."
    );
    expect(page?.markdown).not.toContain(
      'Could not extract "ConsentBannerProps"'
    );
  });

  it("allows typeTableBasePath to override source-root type resolution", async () => {
    const sourceRoot = await mkdtemp(
      path.join(tmpdir(), "leadtype-source-root-")
    );
    const typeRoot = await mkdtemp(path.join(tmpdir(), "leadtype-types-"));
    extraTempDirs.push(sourceRoot, typeRoot);
    await rm(contentDir, { force: true, recursive: true });
    contentDir = path.join(sourceRoot, "docs");
    await writeMdx(
      path.join(typeRoot, "packages/react/types.ts"),
      `export interface OverrideProps {
  /** Resolved from an explicit type-table base path. */
  enabled: boolean;
}
`
    );
    await writeMdx(
      path.join(contentDir, "reference.mdx"),
      '<AutoTypeTable name="OverrideProps" path="./packages/react/types.ts" />'
    );

    const source = await createDocsSource({
      contentDir,
      typeTableBasePath: typeRoot,
    });
    const page = await source.loadPage("reference");

    expect(page?.markdown).toContain("enabled");
    expect(page?.markdown).toContain(
      "Resolved from an explicit type-table base path."
    );
  });

  it("emits a visible warning when source type extraction fails", async () => {
    const sourceRoot = await mkdtemp(
      path.join(tmpdir(), "leadtype-source-root-")
    );
    extraTempDirs.push(sourceRoot);
    await rm(contentDir, { force: true, recursive: true });
    contentDir = path.join(sourceRoot, "docs");
    await writeMdx(
      path.join(contentDir, "reference.mdx"),
      '<AutoTypeTable name="MissingProps" path="./packages/react/missing.ts" />'
    );

    const source = await createDocsSource({ contentDir });
    const page = await source.loadPage("reference");

    expect(page?.markdown).toContain("Warning:");
    expect(page?.markdown).toContain('Could not extract "MissingProps"');
  });

  it("treats an extracted empty interface as a successful type table", async () => {
    const sourceRoot = await mkdtemp(
      path.join(tmpdir(), "leadtype-source-root-")
    );
    extraTempDirs.push(sourceRoot);
    await rm(contentDir, { force: true, recursive: true });
    contentDir = path.join(sourceRoot, "docs");
    await writeMdx(
      path.join(sourceRoot, "packages/react/types.ts"),
      "export interface Marker {}\n"
    );
    await writeMdx(
      path.join(contentDir, "reference.mdx"),
      '<AutoTypeTable name="Marker" path="./packages/react/types.ts" />'
    );

    const source = await createDocsSource({
      contentDir,
      typeTableStrict: true,
    });
    const page = await source.loadPage("reference");

    expect(page?.markdown).toContain("<TypeTable properties={{}}");
    expect(page?.markdown).not.toContain('Could not extract "Marker"');
  });

  it("throws in strict mode when source type extraction fails", async () => {
    const sourceRoot = await mkdtemp(
      path.join(tmpdir(), "leadtype-source-root-")
    );
    extraTempDirs.push(sourceRoot);
    await rm(contentDir, { force: true, recursive: true });
    contentDir = path.join(sourceRoot, "docs");
    await writeMdx(
      path.join(contentDir, "reference.mdx"),
      '<AutoTypeTable name="MissingProps" path="./packages/react/missing.ts" />'
    );

    const source = await createDocsSource({
      contentDir,
      typeTableStrict: true,
    });

    await expect(source.loadPage("reference")).rejects.toThrow(
      /Could not extract "MissingProps"/
    );
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

  it("loads localized pages with default-locale navigation fallback", async () => {
    await writeMdx(
      path.join(contentDir, "quickstart.mdx"),
      "---\ntitle: Quickstart\ngroup: get-started\n---\nEnglish body.\n"
    );
    await writeMdx(
      path.join(contentDir, "setup.mdx"),
      "---\ntitle: Setup\ngroup: get-started\n---\nEnglish setup.\n"
    );
    await writeMdx(
      path.join(contentDir, "zh/quickstart.mdx"),
      "---\ntitle: 快速开始\ngroup: get-started\n---\n中文正文。\n"
    );

    const source = await createDocsSource({
      contentDir,
      groups: [{ slug: "get-started", title: "Get Started" }],
      i18n: {
        defaultLocale: "en",
        locales: ["en", "zh"],
      },
      locale: "zh",
    });

    const pages = await source.listPages();
    expect(
      pages.map((page) => ({
        fallback: page.isFallback,
        slug: page.slug.join("/"),
        title: page.title,
        urlPath: page.urlPath,
      }))
    ).toEqual([
      {
        fallback: false,
        slug: "zh/quickstart",
        title: "快速开始",
        urlPath: "/docs/zh/quickstart",
      },
      {
        fallback: true,
        slug: "zh/setup",
        title: "Setup",
        urlPath: "/docs/zh/setup",
      },
    ]);

    const fallback = await source.loadPage("zh/setup");
    expect(fallback?.isFallback).toBe(true);
    expect(fallback?.sourceLocale).toBe("en");
    expect(fallback?.markdown).toContain("English setup");

    const logicalFallback = await source.loadPage("setup");
    expect(logicalFallback?.urlPath).toBe("/docs/zh/setup");

    const search = await source.buildSearchIndex();
    expect(search.index.documents.map((entry) => entry[3])).toEqual([
      "/docs/zh/quickstart",
    ]);
  });

  it("rejects duplicate localized source files for the same locale and logical path", async () => {
    await writeMdx(
      path.join(contentDir, "quickstart.md"),
      "---\ntitle: Quickstart\n---\nBody.\n"
    );
    await writeMdx(
      path.join(contentDir, "quickstart.mdx"),
      "---\ntitle: Quickstart duplicate\n---\nBody.\n"
    );

    const source = await createDocsSource({
      contentDir,
      i18n: {
        defaultLocale: "en",
        locales: ["en", "zh"],
      },
      locale: "en",
    });

    await expect(source.listPages()).rejects.toThrow(
      /Duplicate docs file for locale "en"/
    );
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
