import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DocsNavEntry } from "../llm";
import { resolveDocsNavigation } from "../llm";
import type { DocsNavigation } from "../llm/readability";
import { navigation } from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function docsFixture(relativePaths: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "leadtype-nav-"));
  tempDirs.push(root);
  for (const relativePath of relativePaths) {
    const filePath = path.join(root, "docs", `${relativePath}.mdx`);
    await mkdir(path.dirname(filePath), { recursive: true });
    const title = (relativePath.split("/").pop() ?? relativePath)
      .replace(/-/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
    await writeFile(
      filePath,
      `---\ntitle: "${title}"\ndescription: "About ${title}."\n---\n\nBody.\n`,
      "utf8"
    );
  }
  return root;
}

async function resolve(
  srcDir: string,
  nav: DocsNavEntry[]
): Promise<DocsNavigation> {
  return await resolveDocsNavigation({ srcDir, groups: [], nav });
}

/** Section titles with their pages, in resolved order. */
function outline(manifest: DocsNavigation): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (groups: DocsNavigation["groups"], prefix: string): void => {
    for (const group of groups) {
      const key = prefix ? `${prefix} / ${group.title}` : group.title;
      out[key] = group.pages.map((page) => page.urlPath);
      walk(group.children, key);
    }
  };
  walk(manifest.groups, "");
  return out;
}

describe("navigation.fromDirectory", () => {
  it("expands a directory relative to the nearest base", async () => {
    const srcDir = await docsFixture([
      "index",
      "concepts/alpha",
      "concepts/beta",
      "other/gamma",
    ]);

    const manifest = await resolve(srcDir, [
      { title: "Concepts", pages: navigation.fromDirectory("concepts") },
    ]);

    expect(outline(manifest).Concepts).toEqual([
      "/docs/concepts/alpha",
      "/docs/concepts/beta",
    ]);
  });

  it("takes everything under the node's own base by default", async () => {
    const srcDir = await docsFixture(["reference/cli", "reference/source"]);

    const manifest = await resolve(srcDir, [
      {
        title: "Reference",
        base: "reference",
        pages: navigation.fromDirectory(),
      },
    ]);

    expect(outline(manifest).Reference).toEqual([
      "/docs/reference/cli",
      "/docs/reference/source",
    ]);
  });

  it("places pinned pages first, in pin order, ahead of the sorted tail", async () => {
    const srcDir = await docsFixture([
      "concepts/alpha",
      "concepts/beta",
      "concepts/zeta",
    ]);

    const manifest = await resolve(srcDir, [
      {
        title: "Concepts",
        pages: navigation.fromDirectory("concepts", {
          pin: ["concepts/zeta", "concepts/beta"],
        }),
      },
    ]);

    expect(outline(manifest).Concepts).toEqual([
      "/docs/concepts/zeta",
      "/docs/concepts/beta",
      "/docs/concepts/alpha",
    ]);
  });

  it("keeps a new page out of the pinned lead", async () => {
    // The point of pinning: adding a page to the directory must not displace a
    // deliberate ordering decision.
    const srcDir = await docsFixture([
      "concepts/aardvark",
      "concepts/intro",
      "concepts/zeta",
    ]);

    const manifest = await resolve(srcDir, [
      {
        title: "Concepts",
        base: "concepts",
        pages: navigation.fromDirectory(".", { pin: ["intro"] }),
      },
    ]);

    expect(outline(manifest).Concepts[0]).toBe("/docs/concepts/intro");
  });

  it("excludes pages the author does not want swept up", async () => {
    const srcDir = await docsFixture([
      "concepts/alpha",
      "concepts/internal-notes",
    ]);

    const manifest = await resolve(srcDir, [
      {
        title: "Concepts",
        base: "concepts",
        pages: navigation.fromDirectory(".", { exclude: "internal-*" }),
      },
    ]);

    expect(outline(manifest).Concepts).toEqual(["/docs/concepts/alpha"]);
  });

  it("fails when a pin matches nothing, rather than silently doing nothing", async () => {
    const srcDir = await docsFixture(["concepts/alpha"]);

    await expect(
      resolve(srcDir, [
        {
          title: "Concepts",
          base: "concepts",
          pages: navigation.fromDirectory(".", { pin: ["renamed-away"] }),
        },
      ])
    ).rejects.toThrow(/Nav pin "renamed-away".*did not match any page/s);
  });

  it("fails when an earlier root entry shadows a pin, exactly like inside a section", async () => {
    const srcDir = await docsFixture(["setup", "alpha"]);

    // The root of `nav: [...]` assembles first-entry-wins like any titled
    // section, so a pin an earlier entry shadows can never take effect — and
    // used to silently no-op only at the top level.
    await expect(
      resolve(srcDir, [
        "setup",
        ...navigation.fromDirectory(".", { pin: ["setup"] }),
      ])
    ).rejects.toThrow(/Nav pin for "\/docs\/setup" under "root"/);
  });

  it("lets explicit entries and an expansion coexist in one section", async () => {
    const srcDir = await docsFixture([
      "guides/setup",
      "guides/deep/one",
      "guides/deep/two",
    ]);

    const manifest = await resolve(srcDir, [
      {
        title: "Guides",
        base: "guides",
        pages: ["setup", ...navigation.fromDirectory("deep")],
      },
    ]);

    expect(outline(manifest).Guides).toEqual([
      "/docs/guides/setup",
      "/docs/guides/deep/one",
      "/docs/guides/deep/two",
    ]);
  });
});

describe("large repeated trees", () => {
  /**
   * The shape that motivates this: one section per framework, each listing the
   * same pages. Authored by hand it is N frameworks × M pages of config that
   * has to be edited twice — once on disk, once in the tree — every time a
   * page is added.
   */
  const FRAMEWORKS = ["react", "nextjs", "javascript"] as const;
  /** The pages whose position is a decision. */
  const LEAD = ["installation", "quickstart", "hooks"] as const;
  /** The long tail, where alphabetical is as good as any other order. */
  const TAIL = [
    "api",
    "events",
    "examples",
    "faq",
    "migration",
    "troubleshooting",
    "types",
  ] as const;
  const PAGES = [...LEAD, ...TAIL];

  async function frameworkFixture(): Promise<string> {
    return await docsFixture(
      FRAMEWORKS.flatMap((framework) =>
        PAGES.map((page) => `frameworks/${framework}/${page}`)
      )
    );
  }

  const explicit: DocsNavEntry[] = FRAMEWORKS.map((framework) => ({
    title: framework,
    base: `frameworks/${framework}`,
    pages: [...PAGES],
  }));

  // Pin what must lead; let the tail sort. Same resolved order, three lines of
  // intent per section instead of ten lines of inventory.
  const derived: DocsNavEntry[] = FRAMEWORKS.map((framework) => ({
    title: framework,
    base: `frameworks/${framework}`,
    pages: navigation.fromDirectory(".", { pin: [...LEAD] }),
  }));

  it("derives the same resolved order as the hand-listed tree", async () => {
    const srcDir = await frameworkFixture();

    const fromExplicit = outline(await resolve(srcDir, explicit));
    const fromDerived = outline(await resolve(srcDir, derived));

    expect(fromDerived).toEqual(fromExplicit);
    // And the derived form is genuinely smaller: one entry per section instead
    // of one per page per section.
    expect(JSON.stringify(derived).length).toBeLessThan(
      JSON.stringify(explicit).length
    );
  });

  it("absorbs a new page without a config edit, keeping pinned leads", async () => {
    const srcDir = await docsFixture([
      ...FRAMEWORKS.flatMap((framework) =>
        PAGES.map((page) => `frameworks/${framework}/${page}`)
      ),
      "frameworks/react/advanced",
    ]);

    const manifest = await resolve(srcDir, derived);
    const react = outline(manifest).react;

    expect(react.slice(0, 3)).toEqual([
      "/docs/frameworks/react/installation",
      "/docs/frameworks/react/quickstart",
      "/docs/frameworks/react/hooks",
    ]);
    expect(react).toContain("/docs/frameworks/react/advanced");
  });
});
