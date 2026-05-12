#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../../../packages/leadtype/src/cli";
import { generateTypeTables } from "./generate-type-tables";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const repoRoot = join(appRoot, "..", "..");
const sourceRoot = join(repoRoot, ".docs-src", "c15t");
const outDir = join(appRoot, "public");
const baseUrl =
  process.env.C15T_EXAMPLE_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  "https://c15t.example.local";

await mkdir(outDir, { recursive: true });

const code = await runCli([
  "generate",
  "--src",
  sourceRoot,
  "--docs-dir",
  "docs",
  "--docs-dir",
  "changelog=/changelog",
  "--out",
  outDir,
  "--base-url",
  baseUrl,
  "--name",
  "c15t",
  "--summary",
  "Developer-first consent management for modern web apps.",
  "--format",
  "json",
]);

if (code !== 0) {
  process.exit(code);
}

await generateTypeTables({
  outFile: join(outDir, "type-tables.json"),
  sourceRoot,
});
