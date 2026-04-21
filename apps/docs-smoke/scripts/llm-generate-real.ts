#!/usr/bin/env bun
/**
 * Runs the llm generator against real c15t docs so we can inspect
 * /llms.txt and the nested /docs/llms-full/** tree.
 *
 * The topic tree demonstrates the intended shape for any multi-surface SDK:
 * agents pick a task-scoped leaf (e.g. `frameworks/react.txt`) instead of
 * downloading an entire monolithic `llms-full.txt` they'll mostly ignore.
 */

import { join } from "node:path";
import {
  generateLLMFullFiles,
  generateLLMSummaries,
} from "../../../packages/docs/src/llm/index.ts";

const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const SRC_DIR = FIXTURE_DIR;
const OUT_DIR = join(process.cwd(), "public-real2");

await generateLLMSummaries({
  srcDir: SRC_DIR,
  outDir: OUT_DIR,
  baseUrl: "https://c15t.com",
  product: {
    name: "c15t",
    summary: "Open source consent & privacy platform.",
    bullets: [
      "Consent management across web frameworks.",
      "Self-hostable and backend-agnostic.",
    ],
    bestStartingPoints: [{ urlPath: "/docs/frameworks" }],
    agentGuidance:
      "Start with the framework guide that matches your stack, then consult the matching full-context file under /docs/llms-full/.",
  },
  docsSections: [
    {
      title: "Frameworks",
      description: "Framework integrations.",
      links: [{ urlPath: "/docs/frameworks" }],
    },
    {
      title: "Self-host",
      description: "Run c15t yourself.",
      links: [{ urlPath: "/docs/self-host" }],
    },
    {
      title: "Integrations",
      description: "Third-party integrations.",
      links: [{ urlPath: "/docs/integrations/overview" }],
    },
  ],
});

await generateLLMFullFiles({
  outDir: OUT_DIR,
  baseUrl: "https://c15t.com",
  product: { name: "c15t" },
  topics: [
    {
      slug: "frameworks",
      title: "Frameworks",
      description:
        "Framework integrations. Pick the leaf that matches your stack.",
      topics: [
        {
          slug: "react",
          title: "React",
          description:
            "React integration — hooks, components, client-mode configuration.",
          includePrefixes: ["frameworks/react/"],
        },
        {
          slug: "next",
          title: "Next.js",
          description:
            "Next.js integration — App Router, server-side rendering, geolocation.",
          includePrefixes: ["frameworks/next/"],
        },
        {
          slug: "javascript",
          title: "JavaScript",
          description:
            "Framework-agnostic vanilla JavaScript integration for any frontend stack.",
          includePrefixes: ["frameworks/javascript/"],
        },
      ],
    },
    {
      slug: "self-host",
      title: "Self-host",
      description: "Self-host the c15t consent backend in your infrastructure.",
      topics: [
        {
          slug: "guides",
          title: "Guides",
          description:
            "Self-hosting how-to guides — database, caching, edge, observability, policy packs.",
          includePrefixes: ["self-host/guides/", "self-host/quickstart"],
        },
        {
          slug: "api",
          title: "API Reference",
          description:
            "Backend configuration options and HTTP endpoint reference.",
          includePrefixes: ["self-host/api/"],
        },
      ],
    },
    {
      slug: "integrations",
      title: "Integrations",
      description:
        "Third-party integrations — analytics, tag managers, ad pixels.",
      includePrefixes: ["integrations/"],
    },
    {
      slug: "concepts",
      title: "Concepts",
      description:
        "Framework-agnostic concepts — glossary, cookie management, consent model.",
      includePrefixes: ["shared/concepts/"],
    },
  ],
});

process.stdout.write("LLM files generated for real c15t content\n");
