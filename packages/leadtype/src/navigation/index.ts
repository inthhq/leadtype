/**
 * Framework-agnostic navigation helpers.
 *
 * These operate purely on the `DocsNavigation` manifest produced by
 * `resolveDocsNavigation` (emitted as `docs-nav.json` by `leadtype generate`).
 * They contain no framework or bundler coupling and no rendered DOM — every
 * function takes data in and returns data out, so any framework adapter or app
 * can derive its sidebar, header tabs, breadcrumbs, and prev/next links from the
 * same source of truth instead of hand-rolling the traversal.
 */

import type {
  DocsNavigation,
  DocsNavigationGroup,
  DocsNavigationPage,
} from "../llm/readability";

const TRAILING_SLASH_PATTERN = /\/$/;
const UNGROUPED_SECTION_TITLE = "Docs";

export type {
  DocsNavigation,
  DocsNavigationGroup,
  DocsNavigationPage,
} from "../llm/readability";

/** A single sidebar link (one docs page). */
export type DocsSidebarLink = {
  label: string;
  to: string;
};

/** A sidebar section: a group title with its (flattened) page links. */
export type DocsSidebarSection = {
  title: string;
  description?: string;
  links: DocsSidebarLink[];
};

/** A top-level header tab. Docs tabs carry the `groupKey` of their root group. */
export type DocsHeaderTab = {
  label: string;
  to: string;
  description: string;
  /** Set for tabs derived from a docs group; absent for app-defined routes. */
  groupKey?: string;
};

/** One crumb in a breadcrumb trail. */
export type DocsBreadcrumb = {
  label: string;
  to: string;
};

/** The pages immediately before/after the active page in reading order. */
export type DocsAdjacentPages = {
  previous: DocsNavigationPage | null;
  next: DocsNavigationPage | null;
};

/** Strip a trailing slash, preserving a bare root path. */
export function normalizeDocsPath(pathname: string): string {
  return pathname.length > 1
    ? pathname.replace(TRAILING_SLASH_PATTERN, "")
    : pathname;
}

function groupKeyOf(group: DocsNavigationGroup): string {
  return group.segmentPath.join("/");
}

function firstPageInGroup(
  group: DocsNavigationGroup
): DocsNavigationPage | undefined {
  const directPage = group.pages[0];
  if (directPage) {
    return directPage;
  }
  for (const child of group.children) {
    const page = firstPageInGroup(child);
    if (page) {
      return page;
    }
  }
  return;
}

function groupContainsPath(
  group: DocsNavigationGroup,
  pathname: string
): boolean {
  if (group.pages.some((page) => page.urlPath === pathname)) {
    return true;
  }
  return group.children.some((child) => groupContainsPath(child, pathname));
}

function ungroupedContainsPath(
  manifest: DocsNavigation,
  pathname: string
): boolean {
  return manifest.ungrouped.some((page) => page.urlPath === pathname);
}

/** The top-level group whose subtree contains `pathname`, if any. */
export function getActiveGroup(
  manifest: DocsNavigation,
  pathname: string
): DocsNavigationGroup | undefined {
  const normalized = normalizeDocsPath(pathname);
  return manifest.groups.find((group) => groupContainsPath(group, normalized));
}

function flattenGroupPages(group: DocsNavigationGroup): DocsSidebarLink[] {
  const direct = group.pages.map((page) => ({
    label: page.title,
    to: page.urlPath,
  }));
  const nested = group.children.flatMap(flattenGroupPages);
  return [...direct, ...nested];
}

function sectionsForGroup(group: DocsNavigationGroup): DocsSidebarSection[] {
  const directLinks = group.pages.map((page) => ({
    label: page.title,
    to: page.urlPath,
  }));
  const directSection: DocsSidebarSection[] =
    directLinks.length > 0
      ? [
          {
            title: group.title,
            description: group.description,
            links: directLinks,
          },
        ]
      : [];
  const childSections = group.children.map((child) => ({
    title: child.title,
    description: child.description,
    links: flattenGroupPages(child),
  }));
  return [...directSection, ...childSections].filter(
    (section) => section.links.length > 0
  );
}

function sectionsForUngrouped(
  pages: DocsNavigationPage[]
): DocsSidebarSection[] {
  if (pages.length === 0) {
    return [];
  }
  return [
    {
      title: UNGROUPED_SECTION_TITLE,
      links: pages.map((page) => ({
        label: page.title,
        to: page.urlPath,
      })),
    },
  ];
}

/** Which groups {@link getSidebarSections} includes. */
export type DocsSidebarScope = "active" | "all";

export type GetSidebarSectionsOptions = {
  /**
   * `"active"` (default) flattens only the group that owns `pathname` — the
   * tabbed multi-surface layout. `"all"` lists ungrouped pages first, then
   * every root group — the single-sidebar docs layout.
   */
  scope?: DocsSidebarScope;
};

/**
 * Every sidebar section across the whole manifest: ungrouped pages first,
 * then one set of sections per root group. Use for single-sidebar layouts
 * where the header has one "Docs" link instead of per-group tabs.
 */
export function getAllSidebarSections(
  manifest: DocsNavigation
): DocsSidebarSection[] {
  return [
    ...sectionsForUngrouped(manifest.ungrouped),
    ...manifest.groups.flatMap(sectionsForGroup),
  ];
}

/**
 * Sidebar sections for the active surface. Resolves the group that owns
 * `pathname` (falling back to the first group) and flattens it into sections:
 * the group's direct pages, then one section per child group. Pass
 * `{ scope: "all" }` to list every group instead.
 */
export function getSidebarSections(
  manifest: DocsNavigation,
  pathname: string,
  options: GetSidebarSectionsOptions = {}
): DocsSidebarSection[] {
  if (options.scope === "all") {
    return getAllSidebarSections(manifest);
  }
  const normalized = normalizeDocsPath(pathname);
  const activeGroup = getActiveGroup(manifest, normalized);
  if (activeGroup) {
    return sectionsForGroup(activeGroup);
  }
  if (
    ungroupedContainsPath(manifest, normalized) ||
    manifest.groups.length === 0
  ) {
    return sectionsForUngrouped(manifest.ungrouped);
  }
  const fallbackGroup = manifest.groups[0];
  return fallbackGroup ? sectionsForGroup(fallbackGroup) : [];
}

/**
 * Whether `pathname` is `route` or nested beneath it. Use for app-defined
 * header links that should stay active across a route subtree.
 */
export function isRouteActive(pathname: string, route: string): boolean {
  const normalizedPath = normalizeDocsPath(pathname);
  const normalizedRoute = normalizeDocsPath(route);
  return (
    normalizedPath === normalizedRoute ||
    normalizedPath.startsWith(`${normalizedRoute}/`)
  );
}

/** Top-level header tabs — one per root docs group. */
export function getHeaderTabs(manifest: DocsNavigation): DocsHeaderTab[] {
  const groupTabs = manifest.groups.flatMap((group) => {
    const page = firstPageInGroup(group);
    if (!page) {
      return [];
    }
    return [
      {
        label: group.title,
        to: page.urlPath,
        description:
          group.description ??
          `${group.title} documentation rendered from the MDX source.`,
        groupKey: groupKeyOf(group),
      },
    ];
  });
  if (groupTabs.length > 0) {
    return groupTabs;
  }
  const firstUngrouped = manifest.ungrouped[0];
  return firstUngrouped
    ? [
        {
          label: UNGROUPED_SECTION_TITLE,
          to: firstUngrouped.urlPath,
          description: "Documentation rendered from the MDX source.",
        },
      ]
    : [];
}

/**
 * Whether `tab` is active for `pathname`. Docs tabs (with a `groupKey`) match
 * when the active group matches; plain tabs match on exact path. This handles
 * both library-derived docs tabs and app-defined routes.
 */
export function isHeaderTabActive(
  manifest: DocsNavigation,
  pathname: string,
  tab: Pick<DocsHeaderTab, "to" | "groupKey">
): boolean {
  const normalizedPath = normalizeDocsPath(pathname);
  const normalizedTabPath = normalizeDocsPath(tab.to);
  if (tab.groupKey !== undefined) {
    const activeGroup = getActiveGroup(manifest, normalizedPath);
    return activeGroup ? groupKeyOf(activeGroup) === tab.groupKey : false;
  }
  if (normalizedPath === normalizedTabPath) {
    return true;
  }
  const firstUngrouped = manifest.ungrouped[0];
  return Boolean(
    firstUngrouped &&
      normalizedTabPath === normalizeDocsPath(firstUngrouped.urlPath) &&
      ungroupedContainsPath(manifest, normalizedPath)
  );
}

function findPageInGroup(
  group: DocsNavigationGroup,
  pathname: string
): DocsNavigationPage | undefined {
  const directPage = group.pages.find((page) => page.urlPath === pathname);
  if (directPage) {
    return directPage;
  }
  for (const child of group.children) {
    const page = findPageInGroup(child, pathname);
    if (page) {
      return page;
    }
  }
  return;
}

/** The navigation page for `pathname`, searching groups then ungrouped pages. */
export function findNavigationPage(
  manifest: DocsNavigation,
  pathname: string
): DocsNavigationPage | undefined {
  const normalized = normalizeDocsPath(pathname);
  for (const group of manifest.groups) {
    const page = findPageInGroup(group, normalized);
    if (page) {
      return page;
    }
  }
  return manifest.ungrouped.find((page) => page.urlPath === normalized);
}

function groupTrail(
  group: DocsNavigationGroup,
  pathname: string
): DocsNavigationGroup[] | undefined {
  if (group.pages.some((page) => page.urlPath === pathname)) {
    return [group];
  }
  for (const child of group.children) {
    const trail = groupTrail(child, pathname);
    if (trail) {
      return [group, ...trail];
    }
  }
  return;
}

/**
 * Breadcrumb trail from the root group down to the active page. Each group
 * crumb links to that group's first page; the final crumb is the page itself.
 */
export function getBreadcrumbs(
  manifest: DocsNavigation,
  pathname: string
): DocsBreadcrumb[] {
  const normalized = normalizeDocsPath(pathname);
  for (const group of manifest.groups) {
    const trail = groupTrail(group, normalized);
    if (!trail) {
      continue;
    }
    const crumbs: DocsBreadcrumb[] = [];
    for (const node of trail) {
      const first = firstPageInGroup(node);
      if (first) {
        crumbs.push({ label: node.title, to: first.urlPath });
      }
    }
    const page = findNavigationPage(manifest, normalized);
    if (page) {
      crumbs.push({ label: page.title, to: page.urlPath });
    }
    return crumbs;
  }
  const page = manifest.ungrouped.find((item) => item.urlPath === normalized);
  return page ? [{ label: page.title, to: page.urlPath }] : [];
}

function flattenPagesInOrder(group: DocsNavigationGroup): DocsNavigationPage[] {
  return [...group.pages, ...group.children.flatMap(flattenPagesInOrder)];
}

/** All navigation pages in depth-first reading order across every group. */
export function getOrderedPages(
  manifest: DocsNavigation
): DocsNavigationPage[] {
  return [
    ...manifest.groups.flatMap(flattenPagesInOrder),
    ...manifest.ungrouped,
  ];
}

/** The pages immediately before and after `pathname` in reading order. */
export function getAdjacentPages(
  manifest: DocsNavigation,
  pathname: string
): DocsAdjacentPages {
  const normalized = normalizeDocsPath(pathname);
  const ordered = getOrderedPages(manifest);
  const index = ordered.findIndex((page) => page.urlPath === normalized);
  if (index === -1) {
    return { previous: null, next: null };
  }
  return {
    previous: ordered[index - 1] ?? null,
    next: ordered[index + 1] ?? null,
  };
}

/** Bound navigation helpers for a single manifest. */
export type DocsNavigationApi = {
  manifest: DocsNavigation;
  getSidebarSections: (
    pathname: string,
    options?: GetSidebarSectionsOptions
  ) => DocsSidebarSection[];
  getHeaderTabs: () => DocsHeaderTab[];
  getActiveGroup: (pathname: string) => DocsNavigationGroup | undefined;
  findPage: (pathname: string) => DocsNavigationPage | undefined;
  getBreadcrumbs: (pathname: string) => DocsBreadcrumb[];
  getAdjacentPages: (pathname: string) => DocsAdjacentPages;
  getOrderedPages: () => DocsNavigationPage[];
  isHeaderTabActive: (
    pathname: string,
    tab: Pick<DocsHeaderTab, "to" | "groupKey">
  ) => boolean;
};

/**
 * Bind every navigation helper to a single manifest for ergonomic reuse.
 *
 * @example
 * ```ts
 * import { createDocsNavigation } from "leadtype/navigation";
 * import manifest from "@/generated/docs-nav.json";
 *
 * const nav = createDocsNavigation(manifest);
 * const sections = nav.getSidebarSections(pathname);
 * ```
 */
export function createDocsNavigation(
  manifest: DocsNavigation
): DocsNavigationApi {
  return {
    manifest,
    getSidebarSections: (pathname, options) =>
      getSidebarSections(manifest, pathname, options),
    getHeaderTabs: () => getHeaderTabs(manifest),
    getActiveGroup: (pathname) => getActiveGroup(manifest, pathname),
    findPage: (pathname) => findNavigationPage(manifest, pathname),
    getBreadcrumbs: (pathname) => getBreadcrumbs(manifest, pathname),
    getAdjacentPages: (pathname) => getAdjacentPages(manifest, pathname),
    getOrderedPages: () => getOrderedPages(manifest),
    isHeaderTabActive: (pathname, tab) =>
      isHeaderTabActive(manifest, pathname, tab),
  };
}
