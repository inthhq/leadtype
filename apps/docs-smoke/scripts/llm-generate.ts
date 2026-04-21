#!/usr/bin/env bun
/**
 * Generates /llms.txt and /docs/llms-full/*.txt from the converted markdown.
 */

import { join } from "node:path";
import {
  generateLLMFullFiles,
  generateLLMSummaries,
} from "../../../packages/docs/src/llm/index.ts";

const scriptsRoot = process.cwd();
const srcDir = join(scriptsRoot, "content");
const outDir = join(scriptsRoot, "public");

await generateLLMSummaries({
  srcDir,
  outDir,
  baseUrl: "https://docs.example.com",
  product: {
    name: "Smoke SDK",
    summary: "Exercise the @inth/docs pipeline end-to-end.",
    bullets: [
      "Converts MDX to clean markdown via the shared remark pipeline.",
      "Generates llms.txt + topic-specific full-context files.",
    ],
    bestStartingPoints: [{ urlPath: "/docs/guides/quickstart" }],
    agentGuidance:
      "Start with the quickstart, then read the full-context file for deeper work.",
  },
  docsSections: [
    {
      title: "Guides",
      description: "Step-by-step walkthroughs.",
      links: [
        { urlPath: "/docs/guides/quickstart" },
        { urlPath: "/docs/guides/components-fixture" },
      ],
    },
  ],
});

await generateLLMFullFiles({
  outDir,
  baseUrl: "https://docs.example.com",
  product: { name: "Smoke SDK" },
  topics: [
    {
      slug: "guides",
      title: "Guides",
      description: "Full context for every guide.",
      includePrefixes: ["guides/"],
    },
  ],
});

process.stdout.write("LLM files generated\n");
