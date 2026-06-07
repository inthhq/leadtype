#!/usr/bin/env bun
/**
 * Reads the package's `docs.config.ts` and `/docs` MDX source, then generates
 * `/llms.txt`, `/llms-full.txt`, and a `docs-nav.json` manifest into
 * `apps/tanstack/public/`. The config drives both the package's own published
 * docs artifacts and this TanStack app's served artifacts — same source, two
 * consumers.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateFeedArtifacts } from "leadtype/feed";
import {
  generateAgentReadabilityArtifacts,
  generateLLMFullContextFiles,
  generateLlmsTxt,
  generateSkillArtifacts,
  resolveAgentInputs,
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
const LEADING_SLASHES_PATTERN = /^\/+/;
// Base URL precedence: package-specific override, generic deployment URL,
// portless local URL, then a stable docs example fallback.
const baseUrl =
  process.env.LEADTYPE_AGENT_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  process.env.PORTLESS_URL?.trim() ||
  "https://leadtype.dev";

function outputPathForUrlPrefix(urlPrefix: string): string {
  return urlPrefix.replace(LEADING_SLASHES_PATTERN, "");
}

async function copyMountedMarkdownMirrors() {
  for (const mount of docsConfig.mounts ?? []) {
    const expectedUrlPrefix = mount.pathPrefix
      ? `/docs/${mount.pathPrefix}`
      : "/docs";
    if (mount.urlPrefix === expectedUrlPrefix) {
      continue;
    }
    const sourceDir = join(outDir, "docs", mount.pathPrefix);
    if (!existsSync(sourceDir)) {
      continue;
    }
    const targetDir = join(outDir, outputPathForUrlPrefix(mount.urlPrefix));
    await rm(targetDir, { force: true, recursive: true });
    await cp(sourceDir, targetDir, { recursive: true });
  }
}

// Translate the one docs.config.ts into low-level generator inputs (the same
// mapping `leadtype generate` uses): tagline -> summary, llms.sections -> blocks,
// organization -> JSON-LD + agent-card provider, product.docs -> documentationUrl.
const agentInputs = resolveAgentInputs({
  product: docsConfig.product,
  organization: docsConfig.organization,
  llms: docsConfig.llms,
});

await generateLlmsTxt({
  srcDir,
  outDir,
  baseUrl,
  product: agentInputs.product,
  nav: docsConfig.navigation,
  mounts: docsConfig.mounts,
});

await generateLLMFullContextFiles({
  outDir,
  baseUrl,
  product: { name: agentInputs.product.name },
  nav: docsConfig.navigation,
  mounts: docsConfig.mounts,
});

const agentReadability = await generateAgentReadabilityArtifacts({
  outDir,
  baseUrl,
  product: {
    name: agentInputs.product.name,
    summary: agentInputs.product.summary,
  },
  nav: docsConfig.navigation,
  mounts: docsConfig.mounts,
  // Bake the agent-surface config into the manifest so runtime helpers
  // (renderSiteJsonLd, robots) are config-driven from the one docs.config.ts.
  jsonLd: agentInputs.jsonLd,
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
  product: {
    name: agentInputs.product.name,
    summary: agentInputs.product.summary,
  },
  skills: {
    ...docsConfig.agents?.skills,
    agentCard: docsConfig.agents?.agentCard?.enabled,
  },
  mode: "site",
  mcpEnabled: docsConfig.agents?.mcp?.enabled,
  ...(agentInputs.provider ? { provider: agentInputs.provider } : {}),
  ...(agentInputs.documentationUrl
    ? { documentationUrl: agentInputs.documentationUrl }
    : {}),
  ...(docsConfig.agents?.agentCard?.version
    ? { version: docsConfig.agents.agentCard.version }
    : {}),
});

await copyMountedMarkdownMirrors();

await generateFeedArtifacts({
  outDir,
  baseUrl,
  author: agentInputs.product.name,
  feeds: docsConfig.feeds,
  mounts: docsConfig.mounts,
});

// Build the runtime sidebar manifest. Doing this in the build pipeline keeps
// the docs.config.ts as the single source of truth: the same call resolves
// the LLM indexes and the in-app sidebar.
const navigation = await resolveDocsNavigation({
  srcDir,
  baseUrl,
  nav: docsConfig.navigation,
  mounts: docsConfig.mounts,
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
