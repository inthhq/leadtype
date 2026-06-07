import type { DocsConfig } from "leadtype";

const config: DocsConfig = {
  // The documented product — reused across llms.txt, JSON-LD, and the agent card.
  product: {
    name: "Leadtype",
    tagline:
      "A docs pipeline that turns one MDX source into a website, agent-readable artifacts, and a search index.",
    homepage: "https://leadtype.dev",
    docs: "https://leadtype.dev/docs",
    repository: "https://github.com/inthhq/leadtype",
    // A library, so the site-level graph emits SoftwareApplication + SoftwareSourceCode.
    kind: "library",
    category: "DeveloperApplication",
  },
  // Who publishes it → JSON-LD Organization + the agent-card provider.
  organization: { name: "Inth", url: "https://inth.com" },
  // The llms.txt body, rendered in order (was `product.blocks`).
  llms: {
    sections: [
      {
        type: "markdown",
        heading: "Overview",
        body: [
          "- Convert MDX into clean markdown that agents and tools can read.",
          "- Generate llms.txt, a root llms-full.txt fallback, and markdown mirrors.",
          "- Build a static search index plus optional source-grounded AI answers.",
          "- Validate frontmatter, navigation, and internal links before publish.",
        ].join("\n"),
      },
      {
        type: "markdown",
        heading: "Why Leadtype",
        body: [
          "- Framework-neutral: bring your own UI — Next.js, TanStack Start, Astro, Nuxt, or SvelteKit.",
          "- A pipeline, not a docs framework — it coexists with Fumadocs, Starlight, and Mintlify rather than replacing them.",
          "- Ships zero UI components — only primitives, data helpers, and a CLI, so it drops into any stack.",
        ].join("\n"),
      },
      {
        type: "markdown",
        heading: "Project",
        body: "MIT licensed and open source, built by [Inth](https://inth.com). Source on [GitHub](https://github.com/inthhq/leadtype).",
      },
      {
        type: "links",
        heading: "Best Starting Points",
        links: [
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
            urlPath: "/docs/build/sync-docs-across-repos",
            title: "Pinned source docs UI",
            description:
              "Recommended hosted-site shape: a docs UI repo pins a source repo, inherits source-owned navigation, and generates reproducible artifacts.",
          },
          {
            urlPath: "/docs/how-it-works",
            title: "How it works",
            description:
              "Mental model: one MDX source, two output modes, three audiences, plus the canonical vocabulary.",
          },
          {
            urlPath: "/docs/concepts/methodology",
            title: "Methodology",
            description:
              "Why leadtype is a pipeline, not a docs framework — and how it pairs with Fumadocs, Starlight, and Mintlify.",
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
            urlPath: "/docs/concepts/architecture",
            title: "Architecture",
            description:
              "Core package boundary and framework adapter rules — what leadtype ships and what it never will.",
          },
        ],
      },
      {
        type: "markdown",
        heading: "Agent Guidance",
        body: "Start from the Best Starting Points above. On the website, /docs/llms.txt routes by task and /llms-full.txt carries full page context; the bundled AGENTS.md lists the same topics as relative links.",
      },
    ],
  },
  navigation: [
    "index",
    "quickstart",
    "how-it-works",
    {
      title: "Concepts",
      base: "concepts",
      pages: ["methodology", "architecture", "evals"],
    },
    {
      title: "Build an Agent-Ready Site",
      base: "build",
      children: [
        {
          title: "Set up",
          pages: [
            "sync-docs-across-repos",
            "build-a-docs-site",
            "agent-setup-prompts",
            "use-the-source-primitive",
          ],
        },
        {
          title: "Generate & serve",
          pages: [
            "generate-static-artifacts",
            "generate-rss-atom-feeds",
            "optimize-docs-for-agents",
            "serve-agent-responses",
            "deploy-generated-artifacts",
          ],
        },
        {
          title: "Operate",
          pages: ["validate-in-ci", "localize-docs"],
        },
        {
          title: "Integrate",
          pages: ["framework-matrix", "integrate-with-fumadocs"],
        },
      ],
    },
    {
      title: "Search & agents",
      base: "search",
      // MCP + skills are runtime agent-integration features, not buried API
      // reference. Listed here (by absolute path; their /reference/* URLs are
      // unchanged) next to their siblings.
      pages: [
        "add-search",
        "ai-answers",
        "agent-tools",
        "/reference/mcp",
        "/reference/skills",
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
      pages: ["write-for-agents", "frontmatter", "components"],
    },
    {
      title: "Reference",
      base: "reference",
      pages: [
        "cli",
        "source",
        "llm",
        "convert",
        "lint",
        "frontmatter-transformers",
        "mdx",
        "remark",
        "search",
        "i18n",
        "troubleshooting",
      ],
    },
    {
      title: "Changelog",
      base: "changelog",
      // Lower-priority for agents under a tight context budget: collapses into the
      // `## Optional` section of docs/llms.txt rather than its own heading.
      optional: true,
      pages: ["0-3", "0-2"],
    },
  ],
  mounts: [{ pathPrefix: "changelog", urlPrefix: "/changelog" }],
  feeds: [
    {
      id: "changelog",
      title: "Leadtype Changelog",
      description: "Release notes and product updates for Leadtype.",
      source: { urlPrefix: "/changelog" },
      formats: ["rss", "atom"],
      output: {
        rss: "/changelog/rss.xml",
        atom: "/changelog/atom.xml",
      },
    },
  ],
  agents: {
    // Fully crawlable + retrievable; signals "don't train on this" (the default).
    robots: { policy: "balanced" },
    // The example app hosts a docs MCP endpoint, so the docs-skill points agents at it.
    mcp: { enabled: true },
    // Site-wide SEO defaults emitted on every page head via createDocsHead.
    seo: {
      keywords: [
        "documentation pipeline",
        "llms.txt",
        "agent-readable docs",
        "MDX",
        "GEO",
      ],
    },
    // A real capability skill (beyond the auto docs-skill): teach an agent to
    // set leadtype up. `bodyPath` resolves against the docs source root.
    skills: {
      items: [
        {
          name: "setup-agent-ready-docs",
          description:
            "Set up agent-ready documentation with leadtype — llms.txt, Markdown mirrors, JSON-LD, robots/Content-Signals, an agent-skills surface, and an optional docs MCP server. Use when a user wants their docs discoverable and usable by AI agents.",
          license: "MIT",
          allowedTools: ["Bash", "Read", "Edit", "Write"],
          bodyPath: "skills/setup-agent-ready-docs.md",
        },
      ],
    },
  },
};

export default config;
