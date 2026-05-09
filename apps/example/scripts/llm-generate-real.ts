#!/usr/bin/env bun
/**
 * Runs the llm generator against real c15t docs so we can inspect
 * /llms.txt and the nested /docs/llms-full/** tree.
 *
 * The group tree demonstrates the intended shape for any multi-surface SDK:
 * agents pick a task-scoped leaf (e.g. `frameworks/react.txt`) instead of
 * downloading an entire monolithic `llms-full.txt` they'll mostly ignore.
 *
 * NOTE: c15t MDX doesn't currently declare `group:` in frontmatter, so the
 * leaves render empty. Run `bun run scripts/inject-real-groups.ts` (TODO)
 * to backfill frontmatter from top-level directories before this script
 * for representative output.
 */

import { join } from "node:path";
import { generateLLMFullContextFiles, generateLlmsTxt } from "leadtype/llm";

const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const SRC_DIR = FIXTURE_DIR;
const OUT_DIR = join(process.cwd(), "public-real2");

await generateLlmsTxt({
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
  groups: [
    {
      slug: "frameworks",
      title: "Frameworks",
      description:
        "Framework integrations. Pick the leaf that matches your stack.",
      children: [
        {
          slug: "react",
          title: "React",
          description:
            "React integration — hooks, components, client-mode configuration.",
        },
        {
          slug: "next",
          title: "Next.js",
          description:
            "Next.js integration — App Router, server-side rendering, geolocation.",
        },
        {
          slug: "javascript",
          title: "JavaScript",
          description:
            "Framework-agnostic vanilla JavaScript integration for any frontend stack.",
        },
      ],
    },
    {
      slug: "self-host",
      title: "Self-host",
      description: "Self-host the c15t consent backend in your infrastructure.",
      children: [
        {
          slug: "guides",
          title: "Guides",
          description:
            "Self-hosting how-to guides — database, caching, edge, observability, policy packs.",
        },
        {
          slug: "api",
          title: "API Reference",
          description:
            "Backend configuration options and HTTP endpoint reference.",
        },
      ],
    },
    {
      slug: "integrations",
      title: "Integrations",
      description:
        "Third-party integrations — analytics, tag managers, ad pixels.",
    },
    {
      slug: "concepts",
      title: "Concepts",
      description:
        "Framework-agnostic concepts — glossary, cookie management, consent model.",
    },
  ],
});

await generateLLMFullContextFiles({
  outDir: OUT_DIR,
  baseUrl: "https://c15t.com",
  product: { name: "c15t" },
  groups: [
    {
      slug: "frameworks",
      title: "Frameworks",
      description: "Framework integrations.",
      children: [
        { slug: "react", title: "React", description: "React integration." },
        { slug: "next", title: "Next.js", description: "Next.js integration." },
        {
          slug: "javascript",
          title: "JavaScript",
          description: "Vanilla JS integration.",
        },
      ],
    },
    {
      slug: "self-host",
      title: "Self-host",
      description: "Self-hosting context.",
      children: [
        { slug: "guides", title: "Guides", description: "Self-host guides." },
        { slug: "api", title: "API", description: "Backend API reference." },
      ],
    },
    {
      slug: "integrations",
      title: "Integrations",
      description: "Third-party.",
    },
    { slug: "concepts", title: "Concepts", description: "Shared concepts." },
  ],
});

process.stdout.write("LLM files generated for real c15t content\n");
