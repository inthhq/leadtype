#!/usr/bin/env bun
/**
 * Runs the pinned-source docs-UI path against a real c15t checkout: this app's
 * `leadtype.config.ts` declares the source, and `generate` reads the synced
 * cache while inheriting c15t's content-owned config. Use C15T_REF=<branch|sha>
 * before setup to test a c15t PR branch locally.
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

// `--offline`: acquisition belongs to `setup:real`. A generate run that quietly
// cloned would hide a missing setup step and make the build network-dependent.
const code = await runGenerateCommand([
  "--src",
  process.cwd(),
  "--out",
  OUT_DIR,
  "--base-url",
  "https://c15t.com",
  "--offline",
]);

process.exit(code);
