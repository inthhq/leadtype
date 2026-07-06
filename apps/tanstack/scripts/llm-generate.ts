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
import { stageOpenApiDocs } from "leadtype/openapi";
import { updateDocsRedirects } from "leadtype/redirects/node";
import docsConfig from "../../../docs/docs.config";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const repoRoot = join(appRoot, "..", "..");
// Base URL precedence: package-specific override, generic deployment URL,
// portless local URL, then a stable docs example fallback.
const baseUrl =
  process.env.LEADTYPE_AGENT_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  process.env.PORTLESS_URL?.trim() ||
  "https://leadtype.dev";
// Stage generated OpenAPI pages next to the authored docs (temp copy) so the
// llms.txt / nav / readability generators below see them like any other page.
const staged =
  docsConfig.openapi === undefined
    ? undefined
    : await stageOpenApiDocs({
        baseUrl,
        contentDir: join(repoRoot, "docs"),
        openapi: docsConfig.openapi,
      });
try {
  // `generateLlmsTxt` joins `${srcDir}/docs/` and `${outDir}/docs/` internally,
  // so we pass the parents (repo root for source, app root/public for output).
  const srcDir = staged ? dirname(staged.contentDir) : repoRoot;
  const docsNavigation = [
    ...(docsConfig.navigation ?? []),
    ...(staged?.nav ?? []),
  ];
  const outDir = join(appRoot, "public");
  const generatedDir = join(appRoot, "src", "generated");
  const LEADING_SLASHES_PATTERN = /^\/+/;

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
    nav: docsNavigation,
    mounts: docsConfig.mounts,
  });

  await generateLLMFullContextFiles({
    outDir,
    baseUrl,
    product: { name: agentInputs.product.name },
    nav: docsNavigation,
    mounts: docsConfig.mounts,
  });

  const agentReadability = await generateAgentReadabilityArtifacts({
    outDir,
    baseUrl,
    product: {
      name: agentInputs.product.name,
      summary: agentInputs.product.summary,
    },
    nav: docsNavigation,
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
    // Skills read authored files outside /docs (e.g. skills/*.md), so resolve
    // them against the real repo root rather than the staged docs copy.
    srcDir: repoRoot,
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

  // Redirect tracking (dogfooding leadtype's own feature): diff this run's
  // pages against the committed lockfile in /docs, auto-redirect pure moves,
  // and fail the build when a page disappears without a successor. The
  // redirect map is also written into `src/generated` so the docs routes can
  // consult it before throwing notFound().
  const redirectsUpdate = await updateDocsRedirects({
    lockfilePath: join(repoRoot, "docs", "paths.lock.json"),
    outDir,
    pages: agentReadability.manifest.pages.map((page) => ({
      urlPath: page.urlPath,
      relativePath: page.relativePath,
    })),
    removed: docsConfig.redirects?.removed,
  });
  for (const move of redirectsUpdate.moved) {
    process.stdout.write(
      `redirect: ${move.from} -> ${move.to} (rename detected)\n`
    );
  }

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
    nav: docsNavigation,
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
  await writeFile(
    join(generatedDir, "redirects.json"),
    `${JSON.stringify(
      { version: 1, redirects: redirectsUpdate.redirects },
      null,
      2
    )}\n`
  );

  // Static copies would be served by Vite/nitro before the middleware runs,
  // so the live origin would never make it into <loc> / Sitemap:.
  await Promise.all(
    [
      join(outDir, "sitemap.xml"),
      join(outDir, "sitemap.md"),
      join(outDir, "robots.txt"),
    ].map((file) => rm(file, { force: true }))
  );

  process.stdout.write("LLM files + agent readability manifests generated\n");
} finally {
  await staged?.cleanup();
}
