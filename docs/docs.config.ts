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
  organization: {
    name: "Inth",
    url: "https://inth.com",
    email: "support@inth.com",
    sameAs: ["https://github.com/inthhq"],
    contactPoint: {
      contactType: "customer support",
      email: "support@inth.com",
    },
  },
  openapi: {
    input: "./openapi/leadtype-api.yaml",
    output: "rest-api",
    title: "Leadtype REST API",
    description:
      "Generated from docs/openapi/leadtype-api.yaml to dogfood native API reference pages.",
    groupByTags: true,
  },
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
            urlPath: "/docs/pipeline/sync-docs-across-repos",
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
            urlPath: "/docs/pipeline/build-a-docs-site",
            title: "Build an agent-ready docs site",
            description:
              "Decide between the source primitive and the static artifact CLI for your hosted docs site.",
          },
          {
            urlPath: "/docs/pipeline/use-the-source-primitive",
            title: "Use the source primitive",
            description:
              "Wire createDocsSource() into Next, TanStack Start, Nuxt, Astro, or SvelteKit.",
          },
          {
            urlPath: "/docs/pipeline/generate-static-artifacts",
            title: "Generate static artifacts",
            description:
              "Run the site-mode CLI from a build pipeline to write llms.txt, markdown mirrors, search, sitemap, and Agent Readability files.",
          },
          {
            urlPath: "/docs/pipeline/redirects",
            title: "Redirect renamed pages",
            description:
              "Track renamed and deleted pages with a committed lockfile, emit redirects.json, and serve 308/410 responses.",
          },
          {
            urlPath: "/docs/aeo/overview",
            title: "AEO & Agent Readability overview",
            description:
              "The full agent surface in one map — every artifact leadtype emits, the agent-readability spec coverage, and how to audit your score.",
          },
          {
            urlPath: "/docs/aeo/optimize-docs-for-agents",
            title: "Optimize docs for agents",
            description:
              "Generate the discovery and attribution files; verify them locally.",
          },
          {
            urlPath: "/docs/aeo/generate-artifacts-without-docs",
            title: "Agent artifacts without a docs tree",
            description:
              "Emit llms.txt, markdown mirrors, sitemaps, and robots.txt from an in-memory page list — CMS blogs, data-driven sites, microfrontends.",
          },
          {
            urlPath: "/docs/writing/write-for-agents",
            title: "Write for agents",
            description:
              "Content guidance: document the non-obvious instead of restating types and CLI help.",
          },
          {
            urlPath: "/docs/aeo/serve-agent-responses",
            title: "Serve agent responses",
            description:
              "Wire markdown content negotiation, JSON-LD, and sitemap/robots regenerators into your framework.",
          },
          {
            urlPath: "/docs/pipeline/configure-sources",
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
      title: "Docs Pipeline",
      base: "pipeline",
      children: [
        {
          title: "Sources",
          pages: ["configure-sources", "collections", "sync-docs-across-repos"],
        },
        {
          title: "Build",
          pages: [
            "build-a-docs-site",
            "use-the-source-primitive",
            "agent-setup-prompts",
          ],
        },
        {
          title: "Generate & operate",
          pages: [
            "generate-static-artifacts",
            "generate-rss-atom-feeds",
            "deploy-generated-artifacts",
            "validate-in-ci",
            "localize-docs",
          ],
        },
      ],
    },
    {
      title: "AEO & Agent Readability",
      base: "aeo",
      // MCP + skills + WebMCP are agent-surface features, not buried API
      // reference. Listed here (by absolute path; their /reference/* URLs are
      // unchanged) next to the artifact guides.
      pages: [
        "overview",
        "optimize-docs-for-agents",
        "generate-artifacts-without-docs",
        "serve-agent-responses",
        "/reference/skills",
        "/reference/mcp",
        "/reference/webmcp",
        "/reference/nlweb",
      ],
    },
    {
      title: "Writing for Agents",
      base: "writing",
      pages: ["write-for-agents", "frontmatter", "components"],
    },
    {
      title: "Search & AI Answers",
      base: "search",
      pages: ["add-search", "ai-answers", "agent-tools"],
    },
    {
      title: "Package Docs",
      base: "package-docs",
      pages: ["bundle"],
    },
    {
      title: "Integrations",
      base: "integrations",
      pages: ["framework-matrix", "integrate-with-fumadocs"],
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
        "markdown",
        "openapi",
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
      pages: ["0-4", "0-3", "0-2"],
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
    // Library default for the repo's own example output. The deployed site's
    // robots policy is host-owned: the consuming app's leadtype.config.ts
    // (not this source config) controls it — site controls never inherit.
    robots: { policy: "balanced" },
    // The example app hosts a docs MCP endpoint, so leadtype emits discovery metadata for it.
    mcp: { enabled: true },
    // Dogfood the NLWeb surface: schema feeds + Schemamap directive + /ask discovery.
    nlweb: { enabled: true },
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
