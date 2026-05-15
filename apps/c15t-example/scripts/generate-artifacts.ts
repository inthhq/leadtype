#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../../../packages/leadtype/src/cli";
import { generateTypeTables } from "./generate-type-tables";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const sourceRoot = join(appRoot, ".docs-src", "c15t");
const outDir = join(appRoot, "public");
const baseUrl =
  process.env.C15T_EXAMPLE_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  "https://c15t.example.local";

await mkdir(outDir, { recursive: true });

// Product name/summary and the docs/changelog collections live in
// leadtype.config.ts. `--sync` clones c15t into `<appRoot>/.docs-src/c15t`
// on first run and is a no-op on subsequent runs.
const code = await runCli([
  "generate",
  "--src",
  appRoot,
  "--out",
  outDir,
  "--base-url",
  baseUrl,
  "--sync",
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
