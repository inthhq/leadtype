import { defineDocsConfig } from "leadtype";

export default defineDocsConfig({
  product: {
    name: "Leadtype",
    summary:
      "A docs pipeline that turns one MDX source into a website, agent-readable artifacts, and a search index.",
    bullets: [
      "Convert MDX into clean markdown that agents and tools can read.",
      "Generate llms.txt, a root llms-full.txt fallback, and markdown mirrors.",
      "Build a static search index plus optional source-grounded answers.",
      "Validate frontmatter, navigation, and internal links before publish.",
    ],
    bestStartingPoints: [
      { urlPath: "/docs" },
      { urlPath: "/docs/quickstart" },
      { urlPath: "/docs/how-it-works" },
      { urlPath: "/docs/build/connect-docs-site" },
      { urlPath: "/docs/build/optimize-docs-for-agents" },
      { urlPath: "/docs/build/bundle-package-docs" },
    ],
    agentGuidance:
      "Open /docs/llms.txt to route the task, then use /llms-full.txt only when page-level markdown is not enough.",
  },
  groups: [
    {
      slug: "get-started",
      title: "Get Started",
      description:
        "What leadtype is, how it fits together, and the five-minute happy path.",
    },
    {
      slug: "authoring",
      title: "Authoring",
      description:
        "The content contract: frontmatter, groups, and the MDX components the pipeline can flatten.",
    },
    {
      slug: "build",
      title: "Build",
      description:
        "Two journeys: ship docs inside an npm package, or wire leadtype into a docs site.",
    },
    {
      slug: "reference",
      title: "Reference",
      description:
        "CLI flags, conversion APIs, remark plugins, LLM files, search, and lint rules.",
    },
  ],
});
