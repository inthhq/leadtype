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

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const repoRoot = join(appRoot, "..", "..");
const srcDir = join(repoRoot, "docs");
const outDir = join(appRoot, "public", "docs");
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

await rm(outDir, { recursive: true, force: true });

await convertAllMdx({
  srcDir,
  outDir,
  markdownTransforms,
  enrichFrontmatterFromGit: true,
});
