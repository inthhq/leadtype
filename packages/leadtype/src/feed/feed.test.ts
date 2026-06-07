import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setLogStreams } from "../internal/logger";
import {
  type DocsFeedConfig,
  type FeedEntry,
  generateFeedArtifacts,
  renderAtomFeed,
  renderRssFeed,
} from "./index";

const entries: FeedEntry[] = [
  {
    id: "https://example.com/changelog/v2",
    title: "Version 2 & beyond",
    url: "https://example.com/changelog/v2",
    urlPath: "/changelog/v2",
    summary: "Second release <stable>.",
    publishedAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  },
  {
    id: "https://example.com/changelog/v1",
    title: "Version 1",
    url: "https://example.com/changelog/v1",
    urlPath: "/changelog/v1",
    summary: "First release.",
    publishedAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

describe("feed renderers", () => {
  it("renders escaped RSS 2.0 XML", () => {
    const rss = renderRssFeed({
      title: "Product Updates",
      description: "Release notes & updates.",
      siteUrl: "https://example.com/changelog",
      feedUrl: "https://example.com/changelog/rss.xml",
      entries,
      generatedAt: "2026-06-03T00:00:00.000Z",
    });

    expect(rss).toContain('<rss version="2.0">');
    expect(rss).toContain("<title>Version 2 &amp; beyond</title>");
    expect(rss).toContain(
      "<description>Second release &lt;stable&gt;.</description>"
    );
    expect(rss).toContain(
      '<atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="https://example.com/changelog/rss.xml" rel="self" type="application/rss+xml" />'
    );
    expect(rss.indexOf("/changelog/v2")).toBeLessThan(
      rss.indexOf("/changelog/v1")
    );
  });

  it("renders Atom XML with stable entry IDs", () => {
    const atom = renderAtomFeed({
      title: "Product Updates",
      description: "Release notes & updates.",
      siteUrl: "https://example.com/changelog",
      feedUrl: "https://example.com/changelog/atom.xml",
      entries,
      generatedAt: "2026-06-03T00:00:00.000Z",
    });

    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(atom).toContain("<id>https://example.com/changelog</id>");
    expect(atom).toContain("<id>https://example.com/changelog/v2</id>");
    expect(atom).toContain(
      '<link href="https://example.com/changelog/atom.xml" rel="self" />'
    );
    expect(atom).toContain("<updated>2026-06-02T00:00:00.000Z</updated>");
  });

  it("renders a feed-level Atom author when provided", () => {
    const atom = renderAtomFeed({
      title: "Product Updates",
      author: "Feed Product <Team>",
      siteUrl: "https://example.com/changelog",
      feedUrl: "https://example.com/changelog/atom.xml",
      entries,
      generatedAt: "2026-06-03T00:00:00.000Z",
    });

    expect(atom).toContain("<author>");
    expect(atom).toContain("<name>Feed Product &lt;Team&gt;</name>");
  });

  it("bumps the Atom feed <updated> when an older entry was edited last", () => {
    const editedOlderEntry: FeedEntry = {
      ...entries[1],
      updatedAt: "2026-06-05T00:00:00.000Z",
    };
    const atom = renderAtomFeed({
      title: "Product Updates",
      siteUrl: "https://example.com/changelog",
      feedUrl: "https://example.com/changelog/atom.xml",
      entries: [entries[0], editedOlderEntry],
      generatedAt: "2026-06-03T00:00:00.000Z",
    });

    expect(atom).toContain("<updated>2026-06-05T00:00:00.000Z</updated>");
  });

  it("renders empty feeds without items and strips control characters", () => {
    const rss = renderRssFeed({
      title: "Product\u0000 Updates\u0001",
      siteUrl: "https://example.com/changelog",
      feedUrl: "https://example.com/changelog/rss.xml",
      entries: [],
      generatedAt: "2026-06-03T00:00:00.000Z",
    });
    expect(rss).not.toContain("<item>");
    expect(rss).toContain("<title>Product Updates</title>");

    const atom = renderAtomFeed({
      title: "Product Updates",
      siteUrl: "https://example.com/changelog",
      feedUrl: "https://example.com/changelog/atom.xml",
      entries: [],
      generatedAt: "2026-06-03T00:00:00.000Z",
    });
    expect(atom).not.toContain("<entry>");
    expect(atom).toContain("<updated>2026-06-03T00:00:00.000Z</updated>");
  });

  it("omits description and summary for entries without one", () => {
    const entry: FeedEntry = {
      id: "https://example.com/changelog/v3",
      title: "Version 3",
      url: "https://example.com/changelog/v3",
      urlPath: "/changelog/v3",
      publishedAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
    };
    const rss = renderRssFeed({
      title: "Product Updates",
      siteUrl: "https://example.com/changelog",
      feedUrl: "https://example.com/changelog/rss.xml",
      entries: [entry],
      generatedAt: "2026-06-04T00:00:00.000Z",
    });
    expect(rss).not.toContain("<description></description>");

    const atom = renderAtomFeed({
      title: "Product Updates",
      siteUrl: "https://example.com/changelog",
      feedUrl: "https://example.com/changelog/atom.xml",
      entries: [entry],
      generatedAt: "2026-06-04T00:00:00.000Z",
    });
    expect(atom).not.toContain("<summary>");
  });
});

const CHANGELOG_MOUNTS = [{ pathPrefix: "changelog", urlPrefix: "/changelog" }];

function changelogFeed(overrides?: Partial<DocsFeedConfig>): DocsFeedConfig {
  return {
    id: "changelog",
    title: "Changelog",
    source: { urlPrefix: "/changelog" },
    formats: ["rss"],
    output: { rss: "/changelog/rss.xml" },
    ...overrides,
  };
}

async function writeFeedPage(
  outDir: string,
  relativePath: string,
  frontmatter: string
): Promise<void> {
  const filePath = path.join(outDir, "docs", relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `---\n${frontmatter}\n---\n\n# Page\n`);
}

describe("generateFeedArtifacts", () => {
  const tempDirs: string[] = [];

  async function createOutDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "leadtype-feed-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    setLogStreams({ stderr: process.stderr });
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("selects every page when source.urlPrefix is the site root", async () => {
    const outDir = await createOutDir();
    await writeFeedPage(
      outDir,
      "quickstart.md",
      'title: "Quickstart"\ndate: 2026-06-01'
    );
    await writeFeedPage(
      outDir,
      "changelog/v1.md",
      'title: "Version 1"\ndate: 2026-06-02'
    );

    const result = await generateFeedArtifacts({
      outDir,
      baseUrl: "https://example.com",
      feeds: [
        changelogFeed({
          id: "everything",
          source: { urlPrefix: "/" },
          output: { rss: "/rss.xml" },
        }),
      ],
      mounts: CHANGELOG_MOUNTS,
    });

    const { readFile } = await import("node:fs/promises");
    const rss = await readFile(result.files.everything?.rss ?? "", "utf8");
    expect(rss).toContain("https://example.com/docs/quickstart");
    expect(rss).toContain("https://example.com/changelog/v1");
  });

  it("truncates entries to the configured limit, newest first", async () => {
    const outDir = await createOutDir();
    await writeFeedPage(
      outDir,
      "changelog/v1.md",
      'title: "Version 1"\ndate: 2026-06-01'
    );
    await writeFeedPage(
      outDir,
      "changelog/v2.md",
      'title: "Version 2"\ndate: 2026-06-02'
    );
    await writeFeedPage(
      outDir,
      "changelog/v3.md",
      'title: "Version 3"\ndate: 2026-06-03'
    );

    const result = await generateFeedArtifacts({
      outDir,
      baseUrl: "https://example.com",
      feeds: [changelogFeed({ limit: 2 })],
      mounts: CHANGELOG_MOUNTS,
    });

    const { readFile } = await import("node:fs/promises");
    const rss = await readFile(result.files.changelog?.rss ?? "", "utf8");
    expect(rss).toContain("/changelog/v3");
    expect(rss).toContain("/changelog/v2");
    expect(rss).not.toContain("/changelog/v1");
  });

  it("fails when a selected page has no date or lastModified frontmatter", async () => {
    const outDir = await createOutDir();
    await writeFeedPage(outDir, "changelog/v1.md", 'title: "Version 1"');

    await expect(
      generateFeedArtifacts({
        outDir,
        baseUrl: "https://example.com",
        feeds: [changelogFeed()],
        mounts: CHANGELOG_MOUNTS,
      })
    ).rejects.toThrow(/missing date or lastModified frontmatter/);
  });

  it("accepts lastModified frontmatter in place of date", async () => {
    const outDir = await createOutDir();
    await writeFeedPage(
      outDir,
      "changelog/v1.md",
      'title: "Version 1"\nlastModified: 2026-06-01'
    );

    const result = await generateFeedArtifacts({
      outDir,
      baseUrl: "https://example.com",
      feeds: [changelogFeed()],
      mounts: CHANGELOG_MOUNTS,
    });

    const { readFile } = await import("node:fs/promises");
    const rss = await readFile(result.files.changelog?.rss ?? "", "utf8");
    expect(rss).toContain("<pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate>");
  });

  it("rejects feed output paths that escape the output directory", async () => {
    const outDir = await createOutDir();
    await writeFeedPage(
      outDir,
      "changelog/v1.md",
      'title: "Version 1"\ndate: 2026-06-01'
    );

    await expect(
      generateFeedArtifacts({
        outDir,
        baseUrl: "https://example.com",
        feeds: [changelogFeed({ output: { rss: "/../escape.xml" } })],
        mounts: CHANGELOG_MOUNTS,
      })
    ).rejects.toThrow(/must resolve inside the output directory/);
  });

  it("rejects feed output paths that are not .xml files", async () => {
    const outDir = await createOutDir();
    await writeFeedPage(
      outDir,
      "changelog/v1.md",
      'title: "Version 1"\ndate: 2026-06-01'
    );

    await expect(
      generateFeedArtifacts({
        outDir,
        baseUrl: "https://example.com",
        feeds: [changelogFeed({ output: { rss: "/docs/quickstart.md" } })],
        mounts: CHANGELOG_MOUNTS,
      })
    ).rejects.toThrow(/must end with "\.xml"/);
  });

  it("rejects colliding output paths across feeds", async () => {
    const outDir = await createOutDir();
    await writeFeedPage(
      outDir,
      "changelog/v1.md",
      'title: "Version 1"\ndate: 2026-06-01'
    );

    await expect(
      generateFeedArtifacts({
        outDir,
        baseUrl: "https://example.com",
        feeds: [changelogFeed(), changelogFeed({ id: "duplicate" })],
        mounts: CHANGELOG_MOUNTS,
      })
    ).rejects.toThrow(/output paths must be unique/);
  });

  it("excludes locale-prefixed pages from feeds", async () => {
    const outDir = await createOutDir();
    await writeFeedPage(
      outDir,
      "changelog/v1.md",
      'title: "Version 1"\ndate: 2026-06-01'
    );
    await writeFeedPage(
      outDir,
      "zh/changelog/v1.md",
      'title: "版本 1"\ndate: 2026-06-01'
    );

    const result = await generateFeedArtifacts({
      outDir,
      baseUrl: "https://example.com",
      feeds: [changelogFeed()],
      mounts: CHANGELOG_MOUNTS,
      i18n: {
        defaultLocale: "en",
        locales: [{ code: "en" }, { code: "zh" }],
      },
    });

    const { readFile } = await import("node:fs/promises");
    const rss = await readFile(result.files.changelog?.rss ?? "", "utf8");
    expect(rss).toContain("Version 1");
    expect(rss).not.toContain("版本 1");
  });

  it("warns when a feed matches no pages", async () => {
    const outDir = await createOutDir();
    await writeFeedPage(
      outDir,
      "changelog/v1.md",
      'title: "Version 1"\ndate: 2026-06-01'
    );

    let stderrOutput = "";
    setLogStreams({
      stderr: {
        write(chunk: string) {
          stderrOutput += chunk;
          return true;
        },
      },
    });

    await generateFeedArtifacts({
      outDir,
      baseUrl: "https://example.com",
      feeds: [
        changelogFeed({
          id: "typo",
          source: { urlPrefix: "/changeIog" },
          output: { rss: "/typo/rss.xml" },
        }),
      ],
      mounts: CHANGELOG_MOUNTS,
    });

    expect(stderrOutput).toContain('feed "typo" matched no pages');
  });
});
