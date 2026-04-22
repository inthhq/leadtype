export interface NavigationRoute {
  description: string;
  label: string;
  to:
    | "/"
    | "/docs"
    | "/docs/search"
    | "/docs/guides/quickstart"
    | "/docs/guides/components-fixture"
    | "/playground"
    | "/search";
}

export const navigationRoutes: NavigationRoute[] = [
  {
    label: "Home",
    to: "/",
    description: "Developer dashboard for the package.",
  },
  {
    label: "Docs",
    to: "/docs",
    description: "Package surface map plus ExtractedTypeTable output.",
  },
  {
    label: "Quickstart",
    to: "/docs/guides/quickstart",
    description: "Implementation path from install to validation.",
  },
  {
    label: "Components",
    to: "/docs/guides/components-fixture",
    description: "Runtime component fixture rendered through MDX.",
  },
  {
    label: "Search APIs",
    to: "/docs/search",
    description: "Static search, answer context, AI streaming, and guards.",
  },
  {
    label: "Recipes",
    to: "/playground",
    description: "Guided integration recipes with live package components.",
  },
  {
    label: "Live Search",
    to: "/search",
    description: "Local search and optional source-grounded answers.",
  },
];

export interface PackageSurface {
  description: string;
  importPath: string;
  lifecycle: "runtime" | "build time" | "optional runtime";
}

export const packageSurfaces: PackageSurface[] = [
  {
    importPath: "@inth/docs",
    lifecycle: "runtime",
    description: "React MDX adapters and individual components.",
  },
  {
    importPath: "@inth/docs/remark",
    lifecycle: "build time",
    description: "remark plugins and `defaultRemarkPlugins`.",
  },
  {
    importPath: "@inth/docs/convert",
    lifecycle: "build time",
    description: "MDX-to-markdown conversion APIs.",
  },
  {
    importPath: "@inth/docs/llm",
    lifecycle: "build time",
    description: "`llms.txt` and full-context generation.",
  },
  {
    importPath: "@inth/docs/search",
    lifecycle: "runtime",
    description: "Edge-safe search runtime, content readers, and guards.",
  },
  {
    importPath: "@inth/docs/search/node",
    lifecycle: "build time",
    description: "Node-only `generateDocsSearchFiles`.",
  },
  {
    importPath: "@inth/docs/search/ai",
    lifecycle: "optional runtime",
    description: "AI SDK answer streaming helper.",
  },
  {
    importPath: "@inth/docs/search/bash",
    lifecycle: "optional runtime",
    description: "bash-tool docs inspection adapter.",
  },
  {
    importPath: "@inth/docs/lint",
    lifecycle: "build time",
    description: "Lint APIs and the `inth-docs-lint` CLI.",
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
    note: "Semantic note blocks rendered from MDX.",
  },
  {
    name: "Card / Cards",
    coverage: ["runtime render", "agent docs"],
    note: "Linkable card grids rendered directly from authoring MDX.",
  },
  {
    name: "Steps / Step",
    coverage: ["runtime render", "agent docs"],
    note: "Structured walkthrough content rendered as semantic ordered lists.",
  },
  {
    name: "Tabs / Tab",
    coverage: ["runtime render", "browser hydration", "agent docs"],
    note: "Hydrated tab panels with keyboard navigation in the browser.",
  },
  {
    name: "CommandTabs",
    coverage: ["runtime render", "browser hydration", "agent docs"],
    note: "Switches install, run, or create commands in-browser.",
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
    note: "Render-prop selector drives the guided recipe playground.",
  },
  {
    name: "Mermaid",
    coverage: ["runtime render", "pipeline conversion", "agent docs"],
    note: "Plain code-block fallback that consumers can enhance later.",
  },
  {
    name: "TypeTable",
    coverage: ["runtime render", "pipeline conversion", "agent docs"],
    note: "Static prop tables rendered in-browser from MDX props.",
  },
  {
    name: "ExtractedTypeTable",
    coverage: ["runtime render", "pipeline conversion"],
    note: "Rendered from extracted fixture data and still validated in the pipeline.",
  },
  {
    name: "Search APIs",
    coverage: ["search/API", "browser hydration"],
    note: "Generated static index, server routes, and optional AI answer streaming.",
  },
];
