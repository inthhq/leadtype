#!/usr/bin/env bun
/**
 * Reads the package's `docs.config.ts` and `/docs` MDX source, then generates
 * `/llms.txt`, `/llms-full.txt`, and a `docs-nav.json` manifest into
 * `apps/example/public/`. The config drives both the package's own published
 * docs artifacts and this example app's served artifacts — same source, two
 * consumers.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateAgentReadabilityArtifacts,
  generateLLMFullContextFiles,
  generateLlmsTxt,
  generateSkillArtifacts,
  resolveDocsNavigation,
} from "leadtype/llm";
import docsConfig from "../../../docs/docs.config";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const repoRoot = join(appRoot, "..", "..");
// `generateLlmsTxt` joins `${srcDir}/docs/` and `${outDir}/docs/` internally,
// so we pass the parents (repo root for source, app root/public for output).
const srcDir = repoRoot;
const outDir = join(appRoot, "public");
const generatedDir = join(appRoot, "src", "generated");
// Base URL precedence: package-specific override, generic deployment URL,
// portless local URL, then a stable docs example fallback.
const baseUrl =
  process.env.LEADTYPE_AGENT_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  process.env.PORTLESS_URL?.trim() ||
  "https://leadtype.dev";

await generateLlmsTxt({
  srcDir,
  outDir,
  baseUrl,
  product: docsConfig.product,
  nav: docsConfig.nav,
});

await generateLLMFullContextFiles({
  outDir,
  baseUrl,
  product: { name: docsConfig.product.name },
  nav: docsConfig.nav,
});

const agentReadability = await generateAgentReadabilityArtifacts({
  outDir,
  baseUrl,
  product: {
    name: docsConfig.product.name,
    summary: docsConfig.product.summary,
  },
  nav: docsConfig.nav,
  // Bake the agent-surface config into the manifest so runtime helpers
  // (renderSiteJsonLd, robots) are config-driven from the one docs.config.ts.
  jsonLd: docsConfig.agents?.jsonLd,
  robotsPolicy: docsConfig.agents?.robots?.policy,
  contentSignals: docsConfig.agents?.robots?.signals,
  seo: docsConfig.agents?.seo,
});

// Agent-skills surface (/.well-known/agent-skills + agent-card). The auto docs-skill
// points agents at /llms.txt and this app's MCP endpoint (agents.mcp.enabled).
await generateSkillArtifacts({
  outDir,
  srcDir,
  baseUrl,
  product: docsConfig.product,
  skills: docsConfig.agents?.skills,
  mode: "site",
  mcpEnabled: docsConfig.agents?.mcp?.enabled,
});

// Build the runtime sidebar manifest. Doing this in the build pipeline keeps
// the docs.config.ts as the single source of truth: the same call resolves
// the LLM indexes and the in-app sidebar.
const navigation = await resolveDocsNavigation({
  srcDir,
  baseUrl,
  nav: docsConfig.nav,
});

if (navigation.unknown.length > 0) {
  for (const { urlPath, slug } of navigation.unknown) {
    process.stderr.write(
      `error: ${urlPath} declares unknown group "${slug}".\n`
    );
  }
  process.exit(1);
}

await mkdir(generatedDir, { recursive: true });
await writeFile(
  join(generatedDir, "docs-nav.json"),
  `${JSON.stringify(navigation, null, 2)}\n`
);
await writeFile(
  join(generatedDir, "agent-readability.json"),
  `${JSON.stringify(agentReadability.manifest, null, 2)}\n`
);

// Static copies would be served by Vite/nitro before the middleware runs,
// so the live origin would never make it into <loc> / Sitemap:.
await Promise.all(
  [
    join(outDir, "sitemap.xml"),
    join(outDir, "sitemap.md"),
    join(outDir, "robots.txt"),
    join(outDir, "docs", "sitemap.xml"),
    join(outDir, "docs", "sitemap.md"),
    join(outDir, "docs", "robots.txt"),
  ].map((file) => rm(file, { force: true }))
);

process.stdout.write("LLM files + agent readability manifests generated\n");
