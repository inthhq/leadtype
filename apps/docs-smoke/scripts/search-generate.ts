#!/usr/bin/env bun
/**
 * Generates a static docs search index from converted markdown.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSearchIndex } from "../../../packages/docs/src/search/node-index.ts";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const outDir = join(appRoot, "public");
const generatedDir = join(appRoot, "src", "generated");
const generatedIndexPath = join(generatedDir, "docs-search-index.json");
const generatedContentPath = join(generatedDir, "docs-search-content.json");

const result = await generateSearchIndex({
  outDir,
  baseUrl: "https://docs.example.com",
});

await mkdir(generatedDir, { recursive: true });
await copyFile(result.outputPath, generatedIndexPath);
if (!result.contentOutputPath) {
  throw new Error("Search content output was not generated.");
}
await copyFile(result.contentOutputPath, generatedContentPath);

process.stdout.write(
  `Search index generated: ${result.docs} docs, ${result.chunks} chunks, ${result.terms} terms\n`
);
