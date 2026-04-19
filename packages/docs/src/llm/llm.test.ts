import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateLLMFullFiles, generateLLMSummaries } from "./llm";

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

describe("generateLLMSummaries", () => {
  it("falls back to section-friendly titles and descriptions for index routes", async () => {
    const projectDir = await createTempProject();
    const docsDir = path.join(projectDir, "docs", "frameworks");
    const outDir = path.join(projectDir, "out");

    await mkdir(docsDir, { recursive: true });
    await writeFile(
      path.join(docsDir, "index.mdx"),
      `<Cards>
  <Card title="React" href="/docs/frameworks/react/quickstart" />
</Cards>
`
    );

    await generateLLMSummaries({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: {
        name: "c15t",
        summary: "Consent platform.",
        bestStartingPoints: [{ urlPath: "/docs/frameworks" }],
      },
      docsSections: [
        {
          title: "Frameworks",
          links: [{ urlPath: "/docs/frameworks" }],
        },
      ],
    });

    const rootSummary = await readFile(path.join(outDir, "llms.txt"), "utf8");
    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );

    expect(rootSummary).toContain(
      "[Frameworks](https://c15t.com/docs/frameworks)"
    );
    expect(rootSummary).toContain("Entry point for Frameworks documentation.");
    expect(rootSummary).not.toContain("[Index]");
    expect(docsSummary).not.toContain("No description provided.");
  });

  it("uses Documentation for root index files without explicit titles", async () => {
    const projectDir = await createTempProject();
    const docsDir = path.join(projectDir, "docs");
    const outDir = path.join(projectDir, "out");

    await mkdir(docsDir, { recursive: true });
    await writeFile(path.join(docsDir, "index.mdx"), "# Welcome\n");

    await generateLLMSummaries({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: {
        name: "c15t",
        summary: "Consent platform.",
        bestStartingPoints: [{ urlPath: "/docs" }],
      },
      docsSections: [
        {
          title: "Overview",
          links: [{ urlPath: "/docs" }],
        },
      ],
    });

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );

    expect(docsSummary).toContain("[Documentation](https://c15t.com/docs)");
    expect(docsSummary).not.toContain("[.](https://c15t.com/docs)");
  });
});

async function seedOutDir(outDir: string): Promise<void> {
  const docsDir = path.join(outDir, "docs");
  await mkdir(path.join(docsDir, "frameworks", "react"), { recursive: true });
  await mkdir(path.join(docsDir, "frameworks", "next"), { recursive: true });
  await mkdir(path.join(docsDir, "self-host", "api"), { recursive: true });
  await mkdir(path.join(docsDir, "self-host", "guides"), { recursive: true });

  const write = (relative: string, frontmatter: string, body: string) =>
    writeFile(
      path.join(docsDir, relative),
      `---\n${frontmatter}\n---\n${body}`
    );

  await write(
    "frameworks/react/quickstart.md",
    "title: React Quickstart\ndescription: Get started with React.",
    "# React Quickstart\n\nBody.\n"
  );
  await write(
    "frameworks/next/quickstart.md",
    "title: Next.js Quickstart\ndescription: Get started with Next.js.",
    "# Next.js Quickstart\n\nBody.\n"
  );
  await write(
    "self-host/api/configuration.md",
    "title: Configuration\ndescription: Config reference.",
    "# Configuration\n\nBody.\n"
  );
  await write(
    "self-host/guides/caching.md",
    "title: Caching\ndescription: Cache guide.",
    "# Caching\n\nBody.\n"
  );
}

describe("generateLLMFullFiles — nested topics", () => {
  it("emits sub-routers and leaves at nested paths", async () => {
    const projectDir = await createTempProject();
    await seedOutDir(projectDir);

    await generateLLMFullFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      topics: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Framework integrations.",
          topics: [
            {
              slug: "react",
              title: "React",
              description: "React integration.",
              includePrefixes: ["frameworks/react/"],
            },
            {
              slug: "next",
              title: "Next.js",
              description: "Next.js integration.",
              includePrefixes: ["frameworks/next/"],
            },
          ],
        },
        {
          slug: "self-host",
          title: "Self-host",
          description: "Self-hosting context.",
          topics: [
            {
              slug: "api",
              title: "API Reference",
              description: "Backend API reference.",
              includePrefixes: ["self-host/api/"],
            },
            {
              slug: "guides",
              title: "Guides",
              description: "Self-hosting how-to.",
              includePrefixes: ["self-host/guides/"],
            },
          ],
        },
      ],
    });

    const rootRouter = await readFile(
      path.join(projectDir, "docs", "llms-full.txt"),
      "utf8"
    );

    expect(rootRouter).toContain(
      "[Frameworks](https://c15t.com/docs/llms-full/frameworks.txt): Framework integrations."
    );
    expect(rootRouter).toContain(
      "  - [React](https://c15t.com/docs/llms-full/frameworks/react.txt): React integration."
    );
    expect(rootRouter).toContain(
      "  - [Next.js](https://c15t.com/docs/llms-full/frameworks/next.txt): Next.js integration."
    );

    const frameworksRouter = await readFile(
      path.join(projectDir, "docs", "llms-full", "frameworks.txt"),
      "utf8"
    );
    expect(frameworksRouter).toContain("# c15t Frameworks Full Context");
    expect(frameworksRouter).toContain(
      "[React](https://c15t.com/docs/llms-full/frameworks/react.txt)"
    );

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

  it("still accepts flat topics (backwards compat)", async () => {
    const projectDir = await createTempProject();
    await seedOutDir(projectDir);

    await generateLLMFullFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      topics: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "All framework docs.",
          includePrefixes: ["frameworks/"],
        },
      ],
    });

    const flatLeaf = await readFile(
      path.join(projectDir, "docs", "llms-full", "frameworks.txt"),
      "utf8"
    );
    expect(flatLeaf).toContain("React Quickstart");
    expect(flatLeaf).toContain("Next.js Quickstart");
    expect(
      existsSync(
        path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt")
      )
    ).toBe(false);
  });

  it("clears stale nested topic files before rewriting the topic tree", async () => {
    const projectDir = await createTempProject();
    await seedOutDir(projectDir);

    await generateLLMFullFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      topics: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "Framework integrations.",
          topics: [
            {
              slug: "react",
              title: "React",
              description: "React integration.",
              includePrefixes: ["frameworks/react/"],
            },
          ],
        },
      ],
    });

    expect(
      existsSync(
        path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt")
      )
    ).toBe(true);

    await generateLLMFullFiles({
      outDir: projectDir,
      baseUrl: "https://c15t.com",
      product: { name: "c15t" },
      topics: [
        {
          slug: "frameworks",
          title: "Frameworks",
          description: "All framework docs.",
          includePrefixes: ["frameworks/"],
        },
      ],
    });

    expect(
      existsSync(
        path.join(projectDir, "docs", "llms-full", "frameworks", "react.txt")
      )
    ).toBe(false);
  });

  it("rejects a topic that declares both includePrefixes and topics", async () => {
    const projectDir = await createTempProject();
    await seedOutDir(projectDir);

    await expect(
      generateLLMFullFiles({
        outDir: projectDir,
        baseUrl: "https://c15t.com",
        product: { name: "c15t" },
        topics: [
          {
            slug: "frameworks",
            title: "Frameworks",
            description: "Mixed.",
            includePrefixes: ["frameworks/"],
            topics: [
              {
                slug: "react",
                title: "React",
                description: "React.",
                includePrefixes: ["frameworks/react/"],
              },
            ],
          },
        ],
      })
    ).rejects.toThrow(/parent \(router\) or a leaf \(content\)/);
  });

  it("rejects a topic with neither includePrefixes nor topics", async () => {
    const projectDir = await createTempProject();
    await seedOutDir(projectDir);

    await expect(
      generateLLMFullFiles({
        outDir: projectDir,
        baseUrl: "https://c15t.com",
        product: { name: "c15t" },
        topics: [
          {
            slug: "empty",
            title: "Empty",
            description: "Nothing.",
          },
        ],
      })
    ).rejects.toThrow(/must declare content/);
  });

  it("rejects duplicate sibling topic slugs", async () => {
    const projectDir = await createTempProject();
    await seedOutDir(projectDir);

    await expect(
      generateLLMFullFiles({
        outDir: projectDir,
        baseUrl: "https://c15t.com",
        product: { name: "c15t" },
        topics: [
          {
            slug: "frameworks",
            title: "Frameworks",
            description: "Framework integrations.",
            topics: [
              {
                slug: "react",
                title: "React",
                description: "React integration.",
                includePrefixes: ["frameworks/react/"],
              },
              {
                slug: "react",
                title: "React duplicate",
                description: "Duplicate React integration.",
                includePrefixes: ["frameworks/next/"],
              },
            ],
          },
        ],
      })
    ).rejects.toThrow(/Duplicate topic slug "react" under "frameworks"/);
  });
});
