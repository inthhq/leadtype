import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DocsNavigation } from "../llm/readability";
import {
  formatInferenceReport,
  inferLlmsBlocks,
  inferNavigationFromContent,
  inferProductFromPackageJson,
} from "./infer";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function docsFixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-infer-"));
  tempDirs.push(dir);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
  return dir;
}

function page(title: string, extra = ""): string {
  return `---\ntitle: "${title}"\ndescription: "About ${title}."\n${extra}---\n\nBody.\n`;
}

describe("inferNavigationFromContent", () => {
  it("lists root pages first, then one section per top-level directory", async () => {
    const dir = await docsFixture({
      "index.mdx": page("Home"),
      "quickstart.mdx": page("Quickstart"),
      "guides/index.mdx": page("Guides"),
      "guides/auth.mdx": page("Auth"),
      "reference/client.mdx": page("Client"),
    });

    const { navigation } = await inferNavigationFromContent(dir);

    expect(navigation).toEqual([
      "index",
      "quickstart",
      {
        title: "Guides",
        base: "guides",
        pages: ["index", "auth"],
        description: "About Guides.",
      },
      {
        title: "Reference",
        base: "reference",
        pages: ["client"],
      },
    ]);
  });

  it("titles a section from its index page, falling back to the directory name", async () => {
    const dir = await docsFixture({
      "api-reference/index.mdx": page("HTTP API"),
      "api-reference/users.mdx": page("Users"),
      "how_to/deploy.mdx": page("Deploy"),
    });

    const { navigation } = await inferNavigationFromContent(dir);
    const titles = navigation.map((entry) =>
      typeof entry === "string" ? entry : entry.title
    );
    expect(titles).toEqual(["HTTP API", "How To"]);
  });

  it("puts an index page first and honours frontmatter order", async () => {
    const dir = await docsFixture({
      "guides/zebra.mdx": page("Zebra"),
      "guides/index.mdx": page("Guides"),
      "guides/apple.mdx": page("Apple", "order: 1\n"),
    });

    const { navigation } = await inferNavigationFromContent(dir);
    const section = navigation[0];
    expect(typeof section === "string" ? null : section.pages).toEqual([
      "index",
      "apple",
      "zebra",
    ]);
  });

  it("is deterministic — the same tree derives the same navigation", async () => {
    const files = {
      "index.mdx": page("Home"),
      "b/one.mdx": page("One"),
      "a/two.mdx": page("Two"),
      "a/one.mdx": page("One"),
    };
    const first = await inferNavigationFromContent(await docsFixture(files));
    const second = await inferNavigationFromContent(await docsFixture(files));
    expect(second.navigation).toEqual(first.navigation);
    // Alphabetical, not filesystem order.
    const titles = first.navigation.map((entry) =>
      typeof entry === "string" ? entry : entry.title
    );
    expect(titles).toEqual(["index", "A", "B"]);
  });

  it("lets a section's order promote the whole section", async () => {
    const dir = await docsFixture({
      "zebra/index.mdx": page("Zebra", "order: 1\n"),
      "apple/index.mdx": page("Apple"),
    });
    const { navigation } = await inferNavigationFromContent(dir);
    const titles = navigation.map((entry) =>
      typeof entry === "string" ? entry : entry.title
    );
    expect(titles).toEqual(["Zebra", "Apple"]);
  });

  it("warns when page titles had to come from filenames", async () => {
    const dir = await docsFixture({
      "index.mdx": page("Home"),
      "untitled-one.mdx": "No frontmatter here.\n",
      "untitled-two.mdx": "Nor here.\n",
    });

    const { report } = await inferNavigationFromContent(dir);
    const warning = report.warnings.find(
      (entry) => entry.field === "navigation"
    );
    expect(warning?.message).toContain("2 pages have no frontmatter `title`");
    expect(warning?.hint).toContain("Add `title:`");
  });

  it("skips excluded paths so another producer's nav can't collide", async () => {
    const dir = await docsFixture({
      "index.mdx": page("Home"),
      "api/list-users.mdx": page("List users"),
    });

    const { navigation } = await inferNavigationFromContent(dir, {
      exclude: ["api/list-users.mdx"],
    });
    expect(navigation).toEqual(["index"]);
  });

  it("derives nothing from an empty tree", async () => {
    const { navigation, report } = await inferNavigationFromContent(
      await docsFixture({})
    );
    expect(navigation).toEqual([]);
    expect(report.values).toEqual([]);
  });
});

function navigationFixture(): DocsNavigation {
  return {
    groups: [
      {
        slug: "guides",
        title: "Guides",
        segmentPath: ["guides"],
        pages: [
          {
            title: "Auth",
            description: "Sign requests.",
            urlPath: "/docs/guides/auth",
            absoluteUrl: "https://acme.dev/docs/guides/auth",
            relativePath: "guides/auth",
            toc: [],
          },
        ],
        children: [],
      },
    ],
    ungrouped: [
      {
        title: "Home",
        description: "Start here.",
        urlPath: "/docs",
        absoluteUrl: "https://acme.dev/docs",
        relativePath: "index",
        toc: [],
      },
    ],
    unknown: [],
  } as unknown as DocsNavigation;
}

describe("inferLlmsBlocks", () => {
  const product = { name: "Acme", tagline: "Acme does one useful thing." };

  it("builds one starting-points block in resolved navigation order", () => {
    const { blocks } = inferLlmsBlocks({
      product,
      navigation: navigationFixture(),
    });

    expect(blocks).toEqual([
      {
        type: "links",
        heading: "Best Starting Points",
        links: [
          { urlPath: "/docs", title: "Home", description: "Start here." },
          {
            urlPath: "/docs/guides/auth",
            title: "Auth",
            description: "Sign requests.",
          },
        ],
      },
    ]);
  });

  it("warns and truncates when navigation is larger than the block", () => {
    const navigation = navigationFixture();
    const { blocks, report } = inferLlmsBlocks({
      product,
      navigation,
      limit: 1,
    });

    const block = blocks[0];
    expect(block.type === "links" && block.links).toHaveLength(1);
    expect(report.warnings[0]?.message).toContain("first 1 of 2 pages");
    expect(report.warnings[0]?.hint).toContain("llms.sections");
  });

  it("derives nothing when navigation is empty", () => {
    const { blocks } = inferLlmsBlocks({
      product,
      navigation: {
        groups: [],
        ungrouped: [],
        unknown: [],
      } as unknown as DocsNavigation,
    });
    expect(blocks).toEqual([]);
  });
});

describe("inferProductFromPackageJson", () => {
  it("reads name and description", async () => {
    const dir = await docsFixture({
      "package.json": JSON.stringify({
        name: "acme-sdk",
        description: "Acme SDK.",
      }),
    });
    expect(await inferProductFromPackageJson(dir)).toEqual({
      name: "acme-sdk",
      tagline: "Acme SDK.",
    });
  });

  it("omits fields the manifest does not supply", async () => {
    const dir = await docsFixture({
      "package.json": JSON.stringify({ name: "acme-sdk" }),
    });
    expect(await inferProductFromPackageJson(dir)).toEqual({
      name: "acme-sdk",
    });
  });

  it("treats a missing or unreadable manifest as no signal, not an error", async () => {
    expect(await inferProductFromPackageJson(await docsFixture({}))).toEqual(
      {}
    );
    const broken = await docsFixture({ "package.json": "{ not json" });
    expect(await inferProductFromPackageJson(broken)).toEqual({});
  });
});

describe("formatInferenceReport", () => {
  it("says so plainly when nothing was inferred", () => {
    expect(formatInferenceReport({ values: [], warnings: [] })).toContain(
      "Nothing was inferred"
    );
  });

  it("names the field, the derivation, and the way to take control", () => {
    const output = formatInferenceReport({
      values: [
        {
          field: "navigation",
          derivedFrom: "the content tree",
          summary: "3 entries",
          makeExplicit: "Set `navigation`.",
        },
      ],
      warnings: [
        { field: "navigation", message: "ambiguous", hint: "do this instead" },
      ],
    });
    expect(output).toContain("navigation");
    expect(output).toContain("the content tree");
    expect(output).toContain("Set `navigation`.");
    expect(output).toContain("ambiguous");
    expect(output).toContain("do this instead");
  });
});
