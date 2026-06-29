#!/usr/bin/env bun
/**
 * Converts and generates llms.txt artifacts for the real c15t checkout.
 */

import { join } from "node:path";
import { convertAllMdx } from "leadtype/convert";
import { generateLLMFullContextFiles, generateLlmsTxt } from "leadtype/llm";
import { defaultMarkdownTransforms, includeMarkdown } from "leadtype/markdown";

const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const SRC_DIR = FIXTURE_DIR;
const OUT_DIR = join(process.cwd(), "public-real2");

await convertAllMdx({
  srcDir: SRC_DIR,
  outDir: OUT_DIR,
  markdownTransforms: [includeMarkdown, ...defaultMarkdownTransforms],
  enrichFrontmatterFromGit: true,
});

await generateLlmsTxt({
  srcDir: SRC_DIR,
  outDir: OUT_DIR,
  baseUrl: "https://c15t.com",
  product: {
    name: "c15t",
    summary: "Open source consent and privacy platform.",
    blocks: [
      {
        type: "markdown",
        heading: "Overview",
        body: "- Consent management across web frameworks.\n- Self-hostable and backend-agnostic.",
      },
      {
        type: "links",
        heading: "Best Starting Points",
        links: [{ urlPath: "/docs/frameworks" }],
      },
      {
        type: "markdown",
        heading: "Agent Guidance",
        body: "Start with the framework guide that matches your stack, then consult /llms-full.txt only when page-level context is not enough.",
      },
    ],
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
            "React integration: hooks, components, client-mode configuration.",
        },
        {
          slug: "next",
          title: "Next.js",
          description:
            "Next.js integration: App Router, server-side rendering, geolocation.",
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
            "Self-hosting how-to guides: database, caching, edge, observability, policy packs.",
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
        "Third-party integrations: analytics, tag managers, ad pixels.",
    },
    {
      slug: "concepts",
      title: "Concepts",
      description:
        "Framework-agnostic concepts: glossary, cookie management, consent model.",
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
