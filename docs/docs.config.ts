import { defineDocsConfig } from "leadtype";

export default defineDocsConfig({
  product: {
    name: "Leadtype",
    summary: "Shared MDX conversion, linting, and LLM-doc generation package.",
    bullets: [
      "Flattens MDX-heavy docs into clean markdown for agents.",
      "Generates llms.txt plus topic-scoped full-context bundles.",
      "Builds compact static search indexes and source-grounded answer prompts.",
      "Validates frontmatter, docs metadata, and internal docs links.",
    ],
    bestStartingPoints: [
      { urlPath: "/docs" },
      { urlPath: "/docs/guides/connect-docs-site" },
      { urlPath: "/docs/convert" },
      { urlPath: "/docs/llm" },
      { urlPath: "/docs/search" },
    ],
    agentGuidance:
      "Start with /docs/llms.txt to route the task, then open the smallest matching topic page.",
  },
  groups: [
    {
      slug: "overview",
      title: "Overview",
      description: "Start here for package scope and surface selection.",
    },
    {
      slug: "guides",
      title: "Guides",
      description: "Practical ways to wire leadtype into docs apps.",
    },
    {
      slug: "authoring",
      title: "Authoring And Rendering",
      description: "React MDX components and remark pipeline behavior.",
      children: [
        {
          slug: "components",
          title: "Components",
          description: "React MDX component adapters.",
        },
        {
          slug: "remark",
          title: "Remark",
          description: "Default plugins and conversion helpers.",
        },
      ],
    },
    {
      slug: "generation",
      title: "Generation",
      description: "MDX conversion, LLM output generation, and search.",
      children: [
        {
          slug: "convert",
          title: "Convert",
          description: "MDX-to-markdown conversion APIs.",
        },
        {
          slug: "llm",
          title: "LLM",
          description: "Summary and full-context file generation.",
        },
        {
          slug: "search",
          title: "Search",
          description: "Static search indexes and AI answer helpers.",
        },
      ],
    },
    {
      slug: "validation",
      title: "Validation",
      description: "Content validation and link checks.",
    },
  ],
});
