import type { DocsNavigation } from "leadtype/llm";
import {
  createDocsNavigation,
  type DocsSidebarSection,
  isRouteActive,
} from "leadtype/navigation";
import docsNavigation from "@/generated/docs-nav.json";

// Framework-agnostic navigation derivation (sidebar, tabs, active page, prev/
// next) lives in `leadtype/navigation`. This module only adds the app-specific
// routes (Docs, Recipes, Live Search) and re-exports the bound helpers the
// TanStack app's components consume.
const nav = createDocsNavigation(docsNavigation as unknown as DocsNavigation);

export const docsNavigationManifest = nav.manifest;

export type { DocsSidebarLink, DocsSidebarSection } from "leadtype/navigation";

export interface NavigationRoute {
  description: string;
  label: string;
  to: string;
}

/** Top-level header nav. Docs sections stay in the sidebar. */
export const navigationRoutes: NavigationRoute[] = [
  {
    label: "Docs",
    to: "/docs",
    description: "Documentation rendered from the MDX source.",
  },
  {
    label: "Recipes",
    to: "/playground",
    description: "Guided integration recipes with live components.",
  },
  {
    label: "Live Search",
    to: "/search",
    description: "Local search and optional source-grounded answers.",
  },
];

export function isNavigationRouteActive(
  pathname: string,
  route: NavigationRoute
): boolean {
  if (route.to === "/docs") {
    // The Docs tab owns both generated surfaces.
    return (
      isRouteActive(pathname, "/docs") || isRouteActive(pathname, "/changelog")
    );
  }
  return isRouteActive(pathname, route.to);
}

export function getDocsSidebarSections(pathname: string): DocsSidebarSection[] {
  return nav.getSidebarSections(pathname, { scope: "all" });
}

export function findDocsNavigationPage(pathname: string) {
  return nav.findPage(pathname);
}

export interface PackageSurface {
  description: string;
  importPath: string;
  lifecycle: "runtime" | "build time" | "optional runtime";
}

export const packageSurfaces: PackageSurface[] = [
  {
    importPath: "leadtype",
    lifecycle: "build time",
    description: "Root export with `defineDocsConfig` and shared types.",
  },
  {
    importPath: "leadtype/markdown",
    lifecycle: "build time",
    description: "markdown transforms and `defaultMarkdownTransforms`.",
  },
  {
    importPath: "leadtype/convert",
    lifecycle: "build time",
    description: "MDX-to-markdown conversion APIs.",
  },
  {
    importPath: "leadtype/llm",
    lifecycle: "build time",
    description: "`llms.txt` and full-context generation.",
  },
  {
    importPath: "leadtype/search",
    lifecycle: "runtime",
    description:
      "Search runtime, content readers, guards, and rate limiter helpers.",
  },
  {
    importPath: "leadtype/search/node",
    lifecycle: "build time",
    description: "Node-only `generateDocsSearchFiles`.",
  },
  {
    importPath: "leadtype/search/vercel",
    lifecycle: "optional runtime",
    description: "Vercel AI Gateway / AI SDK answer streaming and bash tools.",
  },
  {
    importPath: "leadtype/search/tanstack",
    lifecycle: "optional runtime",
    description: "TanStack AI answer streaming and native docs bash tools.",
  },
  {
    importPath: "leadtype/search/cloudflare",
    lifecycle: "optional runtime",
    description:
      "Cloudflare AI Gateway / Workers AI adapter helpers and docs bash tools.",
  },
  {
    importPath: "leadtype/lint",
    lifecycle: "build time",
    description: "Lint APIs and the `leadtype lint` CLI.",
  },
];

export type SmokeCoverage =
  | "agent docs"
  | "browser hydration"
  | "pipeline conversion"
  | "runtime render"
  | "search/API";

export const componentMatrix: Array<{
  coverage: SmokeCoverage[];
  name: string;
  note: string;
}> = [
  {
    name: "Callout",
    coverage: ["runtime render", "agent docs"],
    note: "App-owned semantic note blocks rendered from MDX.",
  },
  {
    name: "Card / Cards",
    coverage: ["runtime render", "agent docs"],
    note: "App-owned card grids rendered directly from authoring MDX.",
  },
  {
    name: "Steps / Step",
    coverage: ["runtime render", "agent docs"],
    note: "App-owned walkthrough content rendered as semantic ordered lists.",
  },
  {
    name: "Tabs / Tab",
    coverage: ["runtime render", "browser hydration", "agent docs"],
    note: "App-owned tab panels with keyboard navigation in the browser.",
  },
  {
    name: "CommandTabs",
    coverage: ["runtime render", "browser hydration", "agent docs"],
    note: "App-owned command switcher for install, run, or create commands.",
  },
  {
    name: "Prompt",
    coverage: ["runtime render", "browser hydration", "agent docs"],
    note: "Copyable agent prompts that flatten into explicit prompt blocks.",
  },
  {
    name: "Audience",
    coverage: ["runtime render", "pipeline conversion", "agent docs"],
    note: "Human-only and agent-only guidance without duplicating pages.",
  },
  {
    name: "FileTree / Folder / File",
    coverage: ["runtime render", "pipeline conversion", "agent docs"],
    note: "Project structure diagrams that flatten into readable text trees.",
  },
  {
    name: "Accordion / AccordionItem",
    coverage: ["runtime render", "pipeline conversion", "agent docs"],
    note: "Collapsible details that still flatten into generated markdown.",
  },
  {
    name: "Example",
    coverage: ["runtime render", "pipeline conversion", "agent docs"],
    note: "Data-driven preview and source examples for authored MDX.",
  },
  {
    name: "TopicSwitcher",
    coverage: ["runtime render", "pipeline conversion", "agent docs"],
    note: "Reader-facing navigation across equivalent docs topics.",
  },
  {
    name: "Selector",
    coverage: ["runtime render", "browser hydration"],
    note: "App-owned selector drives the guided recipe playground.",
  },
  {
    name: "Mermaid",
    coverage: ["runtime render", "pipeline conversion", "agent docs"],
    note: "App-owned code-block fallback that consumers can enhance later.",
  },
  {
    name: "TypeTable",
    coverage: ["runtime render", "pipeline conversion", "agent docs"],
    note: "App-owned prop tables rendered in-browser from MDX props.",
  },
  {
    name: "ExtractedTypeTable",
    coverage: ["runtime render", "pipeline conversion"],
    note: "App-owned rendering for type data still extracted by the pipeline.",
  },
  {
    name: "Search APIs",
    coverage: ["search/API", "browser hydration"],
    note: "Generated static index, server routes, and optional AI answer streaming.",
  },
];
