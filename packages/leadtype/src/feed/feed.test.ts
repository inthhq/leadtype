import { describe, expect, it } from "vitest";
import { type FeedEntry, renderAtomFeed, renderRssFeed } from "./index";

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
});
