import { describe, expect, it } from "vitest";
import type {
  DocsNavigation,
  DocsNavigationGroup,
  DocsNavigationPage,
} from "../llm/readability";
import {
  createDocsNavigation,
  findNavigationPage,
  getActiveGroup,
  getAdjacentPages,
  getAllSidebarSections,
  getBreadcrumbs,
  getHeaderTabs,
  getOrderedPages,
  getSidebarSections,
  isHeaderTabActive,
  isRouteActive,
  normalizeDocsPath,
} from "./index";

function page(urlPath: string, title: string): DocsNavigationPage {
  return {
    urlPath,
    relativePath: urlPath.replace(/^\//, ""),
    title,
    description: `${title} description`,
    groups: [],
    toc: [],
  };
}

function buildManifest(): DocsNavigation {
  const guides: DocsNavigationGroup = {
    slug: "guides",
    segmentPath: ["docs", "guides"],
    title: "Guides",
    description: "Guides group",
    pages: [page("/docs/guides/intro", "Intro")],
    children: [
      {
        slug: "advanced",
        segmentPath: ["docs", "guides", "advanced"],
        title: "Advanced",
        pages: [
          page("/docs/guides/advanced/caching", "Caching"),
          page("/docs/guides/advanced/scaling", "Scaling"),
        ],
        children: [],
      },
    ],
  };
  const reference: DocsNavigationGroup = {
    slug: "reference",
    segmentPath: ["docs", "reference"],
    title: "Reference",
    pages: [page("/docs/reference/cli", "CLI")],
    children: [],
  };
  return {
    groups: [guides, reference],
    ungrouped: [page("/docs/changelog", "Changelog")],
    unknown: [],
  };
}

function buildUngroupedManifest(): DocsNavigation {
  return {
    groups: [],
    ungrouped: [
      page("/docs", "Overview"),
      page("/docs/changelog", "Changelog"),
    ],
    unknown: [],
  };
}

describe("normalizeDocsPath", () => {
  it("strips trailing slash but preserves root", () => {
    expect(normalizeDocsPath("/docs/guides/")).toBe("/docs/guides");
    expect(normalizeDocsPath("/")).toBe("/");
    expect(normalizeDocsPath("/docs/guides")).toBe("/docs/guides");
  });
});

describe("getActiveGroup", () => {
  it("resolves the top group owning a nested page", () => {
    const manifest = buildManifest();
    expect(
      getActiveGroup(manifest, "/docs/guides/advanced/caching")?.slug
    ).toBe("guides");
  });

  it("matches regardless of trailing slash", () => {
    const manifest = buildManifest();
    expect(getActiveGroup(manifest, "/docs/reference/cli/")?.slug).toBe(
      "reference"
    );
  });

  it("returns undefined for unknown paths", () => {
    expect(getActiveGroup(buildManifest(), "/nope")).toBeUndefined();
  });
});

describe("getSidebarSections", () => {
  it("flattens the active group into direct + child sections", () => {
    const sections = getSidebarSections(
      buildManifest(),
      "/docs/guides/advanced/caching"
    );
    expect(sections.map((s) => s.title)).toEqual(["Guides", "Advanced"]);
    expect(sections[1].links.map((l) => l.to)).toEqual([
      "/docs/guides/advanced/caching",
      "/docs/guides/advanced/scaling",
    ]);
  });

  it("falls back to the first group for unknown paths", () => {
    const sections = getSidebarSections(buildManifest(), "/unknown");
    expect(sections[0].title).toBe("Guides");
  });

  it("uses ungrouped pages when the active page is ungrouped", () => {
    const sections = getSidebarSections(buildManifest(), "/docs/changelog");
    expect(sections).toEqual([
      {
        title: "Docs",
        links: [{ label: "Changelog", to: "/docs/changelog" }],
      },
    ]);
  });

  it("supports manifests with only ungrouped pages", () => {
    const sections = getSidebarSections(buildUngroupedManifest(), "/docs");
    expect(sections).toEqual([
      {
        title: "Docs",
        links: [
          { label: "Overview", to: "/docs" },
          { label: "Changelog", to: "/docs/changelog" },
        ],
      },
    ]);
  });

  it('lists ungrouped pages then every group with scope "all"', () => {
    const sections = getSidebarSections(buildManifest(), "/docs/guides/intro", {
      scope: "all",
    });
    expect(sections.map((s) => s.title)).toEqual([
      "Docs",
      "Guides",
      "Advanced",
      "Reference",
    ]);
    expect(sections[0].links).toEqual([
      { label: "Changelog", to: "/docs/changelog" },
    ]);
  });

  it('returns the same full sidebar for every path with scope "all"', () => {
    const manifest = buildManifest();
    expect(
      getSidebarSections(manifest, "/docs/reference/cli", { scope: "all" })
    ).toEqual(
      getSidebarSections(manifest, "/docs/changelog", { scope: "all" })
    );
  });
});

describe("getAllSidebarSections", () => {
  it('matches scope "all" output', () => {
    const manifest = buildManifest();
    expect(getAllSidebarSections(manifest)).toEqual(
      getSidebarSections(manifest, "/anything", { scope: "all" })
    );
  });
});

describe("isRouteActive", () => {
  it("matches the route itself and nested paths", () => {
    expect(isRouteActive("/docs", "/docs")).toBe(true);
    expect(isRouteActive("/docs/guides/intro", "/docs")).toBe(true);
    expect(isRouteActive("/docs/", "/docs")).toBe(true);
  });

  it("does not match siblings or prefixes of other segments", () => {
    expect(isRouteActive("/docsearch", "/docs")).toBe(false);
    expect(isRouteActive("/playground", "/docs")).toBe(false);
    expect(isRouteActive("/", "/docs")).toBe(false);
  });
});

describe("getHeaderTabs", () => {
  it("emits one tab per root group pointing at its first page", () => {
    const tabs = getHeaderTabs(buildManifest());
    expect(tabs).toEqual([
      {
        label: "Guides",
        to: "/docs/guides/intro",
        description: "Guides group",
        groupKey: "docs/guides",
      },
      {
        label: "Reference",
        to: "/docs/reference/cli",
        description: "Reference documentation rendered from the MDX source.",
        groupKey: "docs/reference",
      },
    ]);
  });

  it("emits a docs tab for ungrouped-only manifests", () => {
    expect(getHeaderTabs(buildUngroupedManifest())).toEqual([
      {
        label: "Docs",
        to: "/docs",
        description: "Documentation rendered from the MDX source.",
      },
    ]);
  });
});

describe("isHeaderTabActive", () => {
  it("matches docs tabs by active group", () => {
    const manifest = buildManifest();
    const [guidesTab, referenceTab] = getHeaderTabs(manifest);
    expect(
      isHeaderTabActive(manifest, "/docs/guides/advanced/scaling", guidesTab)
    ).toBe(true);
    expect(
      isHeaderTabActive(manifest, "/docs/guides/advanced/scaling", referenceTab)
    ).toBe(false);
  });

  it("matches plain tabs by exact path", () => {
    const manifest = buildManifest();
    expect(
      isHeaderTabActive(manifest, "/playground/", { to: "/playground" })
    ).toBe(true);
    expect(isHeaderTabActive(manifest, "/other", { to: "/playground" })).toBe(
      false
    );
  });

  it("matches the ungrouped docs tab across ungrouped pages", () => {
    const manifest = buildUngroupedManifest();
    const [docsTab] = getHeaderTabs(manifest);
    expect(isHeaderTabActive(manifest, "/docs/changelog", docsTab)).toBe(true);
  });
});

describe("findNavigationPage", () => {
  it("finds grouped and ungrouped pages", () => {
    const manifest = buildManifest();
    expect(findNavigationPage(manifest, "/docs/guides/intro")?.title).toBe(
      "Intro"
    );
    expect(findNavigationPage(manifest, "/docs/changelog")?.title).toBe(
      "Changelog"
    );
    expect(findNavigationPage(manifest, "/missing")).toBeUndefined();
  });
});

describe("getBreadcrumbs", () => {
  it("builds a trail from root group to the page", () => {
    const crumbs = getBreadcrumbs(
      buildManifest(),
      "/docs/guides/advanced/caching"
    );
    expect(crumbs).toEqual([
      { label: "Guides", to: "/docs/guides/intro" },
      { label: "Advanced", to: "/docs/guides/advanced/caching" },
      { label: "Caching", to: "/docs/guides/advanced/caching" },
    ]);
  });

  it("returns an empty trail for unknown paths", () => {
    expect(getBreadcrumbs(buildManifest(), "/missing")).toEqual([]);
  });

  it("returns the page crumb for ungrouped pages", () => {
    expect(getBreadcrumbs(buildManifest(), "/docs/changelog")).toEqual([
      { label: "Changelog", to: "/docs/changelog" },
    ]);
  });
});

describe("getOrderedPages / getAdjacentPages", () => {
  it("orders pages depth-first across groups", () => {
    expect(getOrderedPages(buildManifest()).map((p) => p.urlPath)).toEqual([
      "/docs/guides/intro",
      "/docs/guides/advanced/caching",
      "/docs/guides/advanced/scaling",
      "/docs/reference/cli",
      "/docs/changelog",
    ]);
  });

  it("returns neighbours in reading order", () => {
    const manifest = buildManifest();
    const adjacent = getAdjacentPages(
      manifest,
      "/docs/guides/advanced/caching"
    );
    expect(adjacent.previous?.urlPath).toBe("/docs/guides/intro");
    expect(adjacent.next?.urlPath).toBe("/docs/guides/advanced/scaling");
  });

  it("returns null neighbours at the ends and for unknown paths", () => {
    const manifest = buildManifest();
    expect(
      getAdjacentPages(manifest, "/docs/guides/intro").previous
    ).toBeNull();
    expect(getAdjacentPages(manifest, "/docs/changelog").next).toBeNull();
    expect(
      getAdjacentPages(manifest, "/docs/reference/cli").next?.urlPath
    ).toBe("/docs/changelog");
    expect(getAdjacentPages(manifest, "/missing")).toEqual({
      previous: null,
      next: null,
    });
  });
});

describe("createDocsNavigation", () => {
  it("binds helpers to a single manifest", () => {
    const nav = createDocsNavigation(buildManifest());
    expect(nav.getHeaderTabs()).toHaveLength(2);
    expect(nav.findPage("/docs/changelog")?.title).toBe("Changelog");
    expect(nav.getSidebarSections("/docs/reference/cli")[0].title).toBe(
      "Reference"
    );
  });
});
