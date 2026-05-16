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
      { urlPath: "/docs/changelog/nav-migration-prompts" },
      { urlPath: "/docs/build/build-a-docs-site" },
      { urlPath: "/docs/build/use-the-source-primitive" },
      { urlPath: "/docs/build/framework-matrix" },
      { urlPath: "/docs/build/deploy-generated-artifacts" },
      { urlPath: "/docs/build/add-search" },
      { urlPath: "/docs/build/optimize-docs-for-agents" },
      { urlPath: "/docs/package-docs/bundle" },
      { urlPath: "/docs/reference/architecture" },
    ],
    agentGuidance:
      "Open /docs/llms.txt to route the task, then use /llms-full.txt only when page-level markdown is not enough.",
  },
  nav: [
    {
      title: "Docs",
      children: [
        {
          title: "Get Started",
          pages: ["", "quickstart", "how-it-works", "methodology"],
        },
        {
          title: "Authoring",
          base: "authoring",
          pages: ["frontmatter", "collections", "components"],
        },
        {
          title: "Build a Docs Site",
          base: "build",
          pages: [
            "build-a-docs-site",
            "use-the-source-primitive",
            "integrate-with-fumadocs",
            "generate-static-artifacts",
            "add-search",
            "optimize-docs-for-agents",
            "validate-in-ci",
          ],
        },
        {
          title: "Ship Package Docs",
          base: "package-docs",
          pages: ["bundle"],
        },
        {
          title: "Reference",
          base: "reference",
          pages: [{ include: "*" }],
        },
      ],
    },
    {
      title: "Changelog",
      base: "changelog",
      pages: ["nav-migration-prompts"],
    },
  ],
});
