import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateLLMFullContextFiles,
  generateLlmsTxt,
  resolveDocsNavigation,
} from "./llm";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "inth-docs-llm-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

type SeedFile = {
  /** Relative path under `<project>/docs/`, e.g. "frameworks/react/quickstart.md" */
  relativePath: string;
  frontmatter: string;
  body?: string;
};

async function seedDocs(projectDir: string, files: SeedFile[]): Promise<void> {
  const docsDir = path.join(projectDir, "docs");
  await Promise.all(
    files.map(async (file) => {
      const fullPath = path.join(docsDir, file.relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(
        fullPath,
        `---\n${file.frontmatter}\n---\n${file.body ?? ""}`
      );
    })
  );
}

describe("generateLlmsTxt", () => {
  it("renders curated docs sections from the group tree and frontmatter", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "frameworks/react/quickstart.mdx",
        frontmatter:
          "title: React Quickstart\ndescription: Get started with React.\ngroup: react",
      },
      {
        relativePath: "frameworks/next/quickstart.mdx",
        frontmatter:
          "title: Next.js Quickstart\ndescription: Get started with Next.js.\ngroup: next",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: {
        name: "c15t",
        summary: "Consent platform.",
        bestStartingPoints: [{ urlPath: "/docs/frameworks/react/quickstart" }],
      },
      groups: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Framework integrations.",
          children: [
            {
              slug: "react",
              title: "React",
              description: "React integration.",
            },
            {
              slug: "next",
              title: "Next.js",
              description: "Next.js integration.",
            },
          ],
        },
      ],
    });

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    expect(docsSummary).toContain("## Frameworks");
    expect(docsSummary).toContain("React Quickstart");
    expect(docsSummary).toContain("Next.js Quickstart");
  });

  it("renders the product summary even when no groups are declared", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "index.mdx",
        frontmatter: "title: Home\ndescription: Welcome.",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: {
        name: "c15t",
        summary: "Consent platform.",
        bestStartingPoints: [{ urlPath: "/docs" }],
      },
      groups: [],
    });

    const rootSummary = await readFile(path.join(outDir, "llms.txt"), "utf8");
    expect(rootSummary).toContain("# c15t");
    expect(rootSummary).toContain("> Consent platform.");
  });

  it("renders shared pages under every group they declare", async () => {
    const projectDir = await createTempProject();
    const outDir = path.join(projectDir, "out");

    await seedDocs(projectDir, [
      {
        relativePath: "rate-limiting.mdx",
        frontmatter:
          "title: Rate Limiting\ndescription: Shared rate-limit reference.\ngroup:\n  - search\n  - self-host",
      },
      {
        relativePath: "search-only.mdx",
        frontmatter:
          "title: Search Only\ndescription: Search-only page.\ngroup: search",
      },
    ]);

    await generateLlmsTxt({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t", summary: "Consent platform." },
      groups: [
        { slug: "search", title: "Search", description: "Search APIs." },
        {
          slug: "self-host",
          title: "Self-host",
          description: "Self-host docs.",
        },
      ],
    });

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    const searchSection = docsSummary.split("## Search")[1] ?? "";
    const selfHostSection = docsSummary.split("## Self-host")[1] ?? "";
    expect(searchSection).toContain("Rate Limiting");
    expect(selfHostSection).toContain("Rate Limiting");
    expect(searchSection).toContain("Search Only");
    expect(selfHostSection).not.toContain("Search Only");
  });
});

describe("generateLLMFullContextFiles", () => {
  it("emits sub-routers and leaves at nested paths", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "frameworks/react/quickstart.md",
        frontmatter:
          "title: React Quickstart\ndescription: React.\ngroup: react",
        body: "# React Quickstart\n\nBody.\n",
      },
      {
        relativePath: "frameworks/next/quickstart.md",
        frontmatter:
          "title: Next.js Quickstart\ndescription: Next.js.\ngroup: next",
        body: "# Next.js Quickstart\n\nBody.\n",
      },
    ]);

    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      groups: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Framework integrations.",
          children: [
            {
              slug: "react",
              title: "React",
              description: "React integration.",
            },
            {
              slug: "next",
              title: "Next.js",
              description: "Next.js integration.",
            },
          ],
        },
      ],
    });

    const rootRouter = await readFile(
      path.join(projectDir, "docs", "llms-full.txt"),
      "utf8"
    );
    expect(rootRouter).toContain("Frameworks");

    const frameworksRouter = await readFile(
      path.join(projectDir, "docs", "llms-full", "frameworks.txt"),
      "utf8"
    );
    expect(frameworksRouter).toContain("# c15t Frameworks Full Context");
    expect(frameworksRouter).toContain("React");

    const reactLeaf = await readFile(
      path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt"),
      "utf8"
    );
    expect(reactLeaf).toContain("# c15t React Full Context");
    expect(reactLeaf).toContain("React Quickstart");
    expect(reactLeaf).not.toContain("Next.js Quickstart");

    const nextLeaf = await readFile(
      path.join(projectDir, "docs", "llms-full", "frameworks", "next.txt"),
      "utf8"
    );
    expect(nextLeaf).toContain("Next.js Quickstart");
    expect(nextLeaf).not.toContain("React Quickstart");
  });

  it("inlines a multi-group page in every named leaf", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "rate-limiting.md",
        frontmatter:
          "title: Rate Limiting\ndescription: Shared rate-limit reference.\ngroup:\n  - search\n  - self-host",
        body: "# Rate Limiting\n\nShared body.\n",
      },
    ]);

    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      groups: [
        { slug: "search", title: "Search", description: "Search APIs." },
        {
          slug: "self-host",
          title: "Self-host",
          description: "Self-host docs.",
        },
      ],
    });

    const searchLeaf = await readFile(
      path.join(projectDir, "docs", "llms-full", "search.txt"),
      "utf8"
    );
    const selfHostLeaf = await readFile(
      path.join(projectDir, "docs", "llms-full", "self-host.txt"),
      "utf8"
    );
    expect(searchLeaf).toContain("Rate Limiting");
    expect(selfHostLeaf).toContain("Rate Limiting");
  });

  it("clears stale nested files before rewriting the group tree", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "frameworks/react/quickstart.md",
        frontmatter:
          "title: React Quickstart\ndescription: React.\ngroup: react",
        body: "# React Quickstart\n",
      },
    ]);

    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      groups: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Frameworks.",
          children: [{ slug: "react", title: "React", description: "React." }],
        },
      ],
    });

    expect(
      existsSync(
        path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt")
      )
    ).toBe(true);

    // Rerun with a flatter shape; the nested react.txt must be removed.
    await generateLLMFullContextFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      groups: [
        { slug: "frameworks", title: "Frameworks", description: "Flat." },
      ],
    });

    expect(
      existsSync(
        path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt")
      )
    ).toBe(false);
  });

  it("rejects duplicate sibling group slugs (case-insensitive)", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "page.md",
        frontmatter: "title: Page\ndescription: Page.\ngroup: react",
        body: "# Page\n",
      },
    ]);

    await expect(
      generateLLMFullContextFiles({
        outDir: projectDir,
        baseUrl: "https://c15t.com",
        product: { name: "c15t" },
        groups: [
          {
            slug: "frameworks",
            title: "Frameworks",
            description: "Frameworks.",
            children: [
              { slug: "React", title: "React", description: "React." },
              { slug: "react", title: "React duplicate", description: "Dup." },
            ],
          },
        ],
      })
    ).rejects.toThrow(/Duplicate group slug "react" under "frameworks"/i);
  });

  it("rejects an invalid group slug shape", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "page.md",
        frontmatter: "title: Page\ndescription: Page.\ngroup: ok",
        body: "# Page\n",
      },
    ]);

    await expect(
      generateLLMFullContextFiles({
        outDir: projectDir,
        baseUrl: "https://c15t.com",
        product: { name: "c15t" },
        groups: [{ slug: "Bad/Slug", title: "Bad", description: "Bad." }],
      })
    ).rejects.toThrow(/Invalid group slug/);
  });
});

describe("resolveDocsNavigation", () => {
  it("returns the group tree, attached pages, and unknown-group references", async () => {
    const projectDir = await createTempProject();
    await seedDocs(projectDir, [
      {
        relativePath: "frameworks/react.mdx",
        frontmatter: "title: React\ndescription: React.\ngroup: react",
      },
      {
        relativePath: "frameworks/next.mdx",
        frontmatter: "title: Next.js\ndescription: Next.\ngroup: next",
      },
      {
        relativePath: "rate-limiting.mdx",
        frontmatter:
          "title: Rate Limit\ndescription: Shared.\ngroup:\n  - react\n  - mystery",
      },
      {
        relativePath: "ungrouped.mdx",
        frontmatter: "title: Ungrouped\ndescription: No group.",
      },
    ]);

    const nav = await resolveDocsNavigation({
      srcDir: projectDir,
      baseUrl: "https://c15t.com",
      groups: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Frameworks.",
          children: [
            { slug: "react", title: "React", description: "React." },
            { slug: "next", title: "Next.js", description: "Next.js." },
          ],
        },
      ],
    });

    expect(nav.groups).toHaveLength(1);
    expect(nav.groups[0]?.slug).toBe("frameworks");
    expect(nav.groups[0]?.children.map((c) => c.slug)).toEqual([
      "react",
      "next",
    ]);

    const reactPages = nav.groups[0]?.children[0]?.pages.map((p) => p.title);
    expect(reactPages).toContain("React");
    expect(reactPages).toContain("Rate Limit");

    const ungroupedTitles = nav.ungrouped.map((p) => p.title);
    expect(ungroupedTitles).toContain("Ungrouped");

    expect(nav.unknown).toContainEqual({
      urlPath: "/docs/rate-limiting",
      slug: "mystery",
    });
  });
});
