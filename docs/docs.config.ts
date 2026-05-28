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
      {
        urlPath: "/docs",
        title: "Overview",
        description:
          "Landing page with the pipeline diagram, the two-path picker, and key term definitions.",
      },
      {
        urlPath: "/docs/quickstart",
        title: "Quickstart (site mode)",
        description:
          "Build one rendered docs route, generate agent artifacts, and verify the output.",
      },
      {
        urlPath: "/docs/how-it-works",
        title: "How it works",
        description:
          "Mental model: one MDX source, two output modes, three audiences, plus the canonical vocabulary.",
      },
      {
        urlPath: "/docs/methodology",
        title: "Methodology",
        description:
          "Why leadtype is a pipeline, not a docs framework — and how it compares to Fumadocs, Starlight, and Mintlify.",
      },
      {
        urlPath: "/docs/build/build-a-docs-site",
        title: "Build an agent-ready docs site",
        description:
          "Decide between the source primitive and the static artifact CLI for your hosted docs site.",
      },
      {
        urlPath: "/docs/build/use-the-source-primitive",
        title: "Use the source primitive",
        description:
          "Wire createDocsSource() into Next, TanStack Start, Nuxt, Astro, or SvelteKit.",
      },
      {
        urlPath: "/docs/build/generate-static-artifacts",
        title: "Generate static artifacts",
        description:
          "Run the site-mode CLI from a build pipeline to write llms.txt, markdown mirrors, search, sitemap, and Agent Readability files.",
      },
      {
        urlPath: "/docs/build/optimize-docs-for-agents",
        title: "Optimize docs for agents",
        description:
          "Generate the discovery and attribution files; verify them locally.",
      },
      {
        urlPath: "/docs/build/serve-agent-responses",
        title: "Serve agent responses",
        description:
          "Wire markdown content negotiation, JSON-LD, and sitemap/robots regenerators into your framework.",
      },
      {
        urlPath: "/docs/sources/configure-sources",
        title: "Configure docs sources",
        description:
          "Pick between one folder, multiple mounted folders, or remote git collections pinned to a ref.",
      },
      {
        urlPath: "/docs/package-docs/bundle",
        title: "Bundle docs into a package",
        description:
          "Ship AGENTS.md + per-topic markdown inside the npm tarball so coding agents read version-matched docs.",
      },
      {
        urlPath: "/docs/reference/architecture",
        title: "Architecture",
        description:
          "Core package boundary and framework adapter rules — what leadtype ships and what it never will.",
      },
    ],
    agentGuidance:
      "Open /docs/llms.txt to route the task, then use /llms-full.txt only when page-level markdown is not enough.",
  },
  nav: [
    {
      title: "Docs",
      children: [
        {
          title: "Start",
          pages: ["", "quickstart", "how-it-works", "methodology"],
        },
        {
          title: "Build an Agent-Ready Site",
          base: "build",
          pages: [
            "build-a-docs-site",
            "use-the-source-primitive",
            "generate-static-artifacts",
            "sync-docs-across-repos",
            "optimize-docs-for-agents",
            "serve-agent-responses",
            "deploy-generated-artifacts",
            "add-search",
            "validate-in-ci",
            "framework-matrix",
            "integrate-with-fumadocs",
          ],
        },
        {
          title: "Docs Sources",
          base: "sources",
          pages: ["configure-sources", "collections"],
        },
        {
          title: "Package Docs for Agents",
          base: "package-docs",
          pages: ["bundle"],
        },
        {
          title: "Author Content",
          base: "authoring",
          pages: ["frontmatter", "components"],
        },
        {
          title: "Reference",
          base: "reference",
          pages: [
            "architecture",
            "cli",
            "source",
            "llm",
            "convert",
            "lint",
            "frontmatter-transformers",
            "mdx",
            "remark",
            "search",
            "evals",
          ],
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
