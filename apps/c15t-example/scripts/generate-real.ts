#!/usr/bin/env bun
/**
 * Runs the same source-config driven generate path a downstream docs repo uses
 * against a real c15t checkout. Use C15T_REF=<branch|sha> before setup to test
 * a c15t PR branch locally.
 */

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runGenerateCommand } from "../../../packages/leadtype/src/cli/generate";

const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const OUT_DIR = join(process.cwd(), "public");

if (!existsSync(join(FIXTURE_DIR, "docs", "docs.config.ts"))) {
  process.stderr.write(
    "content-fixtures/c15t not found - run `bun run setup:real` first.\n"
  );
  process.exit(1);
}

await rm(OUT_DIR, { recursive: true, force: true });

const code = await runGenerateCommand([
  "--src",
  FIXTURE_DIR,
  "--docs-dir",
  "docs",
  "--out",
  OUT_DIR,
  "--base-url",
  "https://c15t.com",
]);

process.exit(code);
