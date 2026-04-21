export interface DemoRoute {
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

export const demoRoutes: DemoRoute[] = [
  {
    label: "Home",
    to: "/",
    description: "Route index.",
  },
  {
    label: "Overview",
    to: "/docs",
    description: "Package docs plus extracted AutoTypeTable output.",
  },
  {
    label: "Search Docs",
    to: "/docs/search",
    description: "Headless search APIs, generated index, and AI answers.",
  },
  {
    label: "Quickstart",
    to: "/docs/guides/quickstart",
    description: "Tabs and package manager switching.",
  },
  {
    label: "Components",
    to: "/docs/guides/components-fixture",
    description: "Callout, Cards, Steps, Tabs, Mermaid, and TypeTable.",
  },
  {
    label: "Playground",
    to: "/playground",
    description: "Direct `Selector` usage.",
  },
  {
    label: "Search",
    to: "/search",
    description: "Headless local search plus AI-grounded answers.",
  },
];

export type ComponentCoverage = "interactive" | "pipeline-only" | "runtime";

export const componentMatrix: Array<{
  coverage: ComponentCoverage[];
  name: string;
  note: string;
}> = [
  {
    name: "Callout",
    coverage: ["runtime"],
    note: "Semantic note blocks rendered from MDX.",
  },
  {
    name: "Card / Cards",
    coverage: ["runtime"],
    note: "Linkable card grids rendered directly from authoring MDX.",
  },
  {
    name: "Steps / Step",
    coverage: ["runtime"],
    note: "Structured walkthrough content rendered as semantic ordered lists.",
  },
  {
    name: "Tabs / Tab",
    coverage: ["interactive"],
    note: "Hydrated tab panels with keyboard navigation in the browser.",
  },
  {
    name: "PackageCommandTabs",
    coverage: ["interactive"],
    note: "Switches install commands in-browser.",
  },
  {
    name: "Selector",
    coverage: ["interactive"],
    note: "Render-prop selector shown in the playground route.",
  },
  {
    name: "Mermaid",
    coverage: ["runtime"],
    note: "Plain code-block fallback that consumers can enhance later.",
  },
  {
    name: "TypeTable",
    coverage: ["runtime"],
    note: "Static prop tables rendered in-browser from MDX props.",
  },
  {
    name: "AutoTypeTable",
    coverage: ["runtime", "pipeline-only"],
    note: "Rendered from extracted fixture data and still validated in the pipeline.",
  },
];
