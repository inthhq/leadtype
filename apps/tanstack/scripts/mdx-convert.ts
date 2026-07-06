#!/usr/bin/env bun
/**
 * Reads the package's MDX source at the repo root `/docs` and writes converted
 * markdown into `apps/tanstack/public/docs` for the dev server. This is exactly
 * what an external consumer (e.g. c15t/c15t) would do with their own docs.
 */

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertAllMdx, type MdxToMarkdownOptions } from "leadtype/convert";
import {
  defaultMarkdownTransforms,
  includeMarkdown,
  nativeMarkdownComponentsToMarkdown,
} from "leadtype/markdown";
import { normalizeOpenApiConfig, writeOpenApiPages } from "leadtype/openapi";
import docsConfig from "../../../docs/docs.config";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const repoRoot = join(appRoot, "..", "..");
const srcDir = join(repoRoot, "docs");
const outDir = join(appRoot, "public", "docs");
const openapiDocsDir = join(appRoot, "src", "generated", "openapi-docs");
const baseUrl = process.env.BASE_URL?.trim() || "https://leadtype.dev";
const typeTableMarkdownTransform: NonNullable<
  MdxToMarkdownOptions["markdownTransforms"]
>[number] = [
  nativeMarkdownComponentsToMarkdown,
  { typeTable: { basePath: repoRoot } },
];
const markdownTransforms: NonNullable<
  MdxToMarkdownOptions["markdownTransforms"]
> = [
  includeMarkdown,
  ...defaultMarkdownTransforms.filter(
    (plugin) => plugin !== nativeMarkdownComponentsToMarkdown
  ),
  typeTableMarkdownTransform,
];

if (!existsSync(srcDir)) {
  process.stderr.write(`Source directory not found: ${srcDir}\n`);
  process.exit(1);
}

const openapiConfigs =
  docsConfig.openapi === undefined
    ? []
    : normalizeOpenApiConfig(docsConfig.openapi, srcDir, { baseUrl });

// Prune replaces the old `rm -rf outDir` sweep: orphaned .md outputs from
// renamed/deleted pages are garbage-collected without a window where the dev
// server serves an empty docs tree. The generated OpenAPI pages convert in a
// second pass below, so their subtrees are exempt here.
await convertAllMdx({
  srcDir,
  outDir,
  markdownTransforms,
  enrichFrontmatterFromGit: true,
  prune: true,
  pruneKeep: openapiConfigs.map((config) => `${config.output}/**`),
});

// Generated OpenAPI reference pages: write the MDX into the app-local
// generated dir (Vite renders it via import.meta.glob), then flatten the same
// pages into the public markdown mirrors so agents and search see them too.
// Authored docs keep git-enriched frontmatter above; generated pages have no
// git history, so enrichment stays off here.
if (openapiConfigs.length > 0) {
  await rm(openapiDocsDir, { force: true, recursive: true });
  await writeOpenApiPages({
    configs: openapiConfigs,
    docsDir: openapiDocsDir,
  });
  await convertAllMdx({
    srcDir: openapiDocsDir,
    outDir,
    markdownTransforms,
    enrichFrontmatterFromGit: false,
  });
}
