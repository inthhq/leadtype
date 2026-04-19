import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertAllMdx } from "../src/convert/index";
import { generateLLMFullFiles, generateLLMSummaries } from "../src/llm/index";
import { defaultRemarkPlugins } from "../src/remark/index";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(PACKAGE_ROOT, "agent-docs-src");
const OUT_DIR = join(PACKAGE_ROOT, "agent-docs");
const baseUrl = process.env.INTH_DOCS_AGENT_BASE_URL;

if (!baseUrl) {
  throw new Error(
    "INTH_DOCS_AGENT_BASE_URL must be set before generating packaged agent docs."
  );
}

await rm(OUT_DIR, { recursive: true, force: true });

await convertAllMdx({
  srcDir: SRC_DIR,
  outDir: OUT_DIR,
  remarkPlugins: defaultRemarkPlugins,
});

await generateLLMSummaries({
  srcDir: SRC_DIR,
  outDir: OUT_DIR,
  baseUrl,
  product: {
    name: "@inth/docs",
    summary: "Shared MDX conversion, linting, and LLM-doc generation package.",
    bullets: [
      "Flattens MDX-heavy docs into clean markdown for agents.",
      "Generates llms.txt plus topic-scoped full-context bundles.",
      "Validates frontmatter, docs metadata, and internal docs links.",
    ],
    bestStartingPoints: [
      { urlPath: "/docs" },
      { urlPath: "/docs/convert" },
      { urlPath: "/docs/llm" },
    ],
    agentGuidance:
      "Start with /docs/llms.txt to route the task, then open the smallest matching topic page.",
  },
  docsSections: [
    {
      title: "Overview",
      description: "Start here for package scope and surface selection.",
      links: [{ urlPath: "/docs" }],
    },
    {
      title: "Authoring And Rendering",
      description: "React MDX components and remark pipeline behavior.",
      links: [{ urlPath: "/docs/components" }, { urlPath: "/docs/remark" }],
    },
    {
      title: "Generation",
      description: "MDX conversion and LLM output generation.",
      links: [{ urlPath: "/docs/convert" }, { urlPath: "/docs/llm" }],
    },
    {
      title: "Validation",
      description: "Content validation and link checks.",
      links: [{ urlPath: "/docs/lint" }],
    },
  ],
});

await generateLLMFullFiles({
  outDir: OUT_DIR,
  baseUrl,
  product: { name: "@inth/docs" },
  topics: [
    {
      slug: "overview",
      title: "Overview",
      description: "Package scope and route-selection guidance.",
      includePrefixes: ["index"],
    },
    {
      slug: "authoring",
      title: "Authoring",
      description: "MDX rendering components and remark pipeline details.",
      topics: [
        {
          slug: "components",
          title: "Components",
          description: "React MDX component adapters.",
          includePrefixes: ["components"],
        },
        {
          slug: "remark",
          title: "Remark",
          description: "Default plugins and conversion helpers.",
          includePrefixes: ["remark"],
        },
      ],
    },
    {
      slug: "generation",
      title: "Generation",
      description: "MDX conversion and llms.txt generation.",
      topics: [
        {
          slug: "convert",
          title: "Convert",
          description: "MDX-to-markdown conversion APIs.",
          includePrefixes: ["convert"],
        },
        {
          slug: "llm",
          title: "LLM",
          description: "Summary and full-context file generation.",
          includePrefixes: ["llm"],
        },
      ],
    },
    {
      slug: "validation",
      title: "Validation",
      description: "Docs linting and CLI usage.",
      includePrefixes: ["lint"],
    },
  ],
});

process.stdout.write(`Generated agent docs in ${OUT_DIR}\n`);
