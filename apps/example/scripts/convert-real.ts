#!/usr/bin/env bun
/**
 * Converts the c15t fixture docs into {outDir}/docs/ so the llm generators
 * can find them (they expect markdown under `{outDir}/docs/`).
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { convertAllMdx } from "leadtype/convert";
import { defaultRemarkPlugins, remarkInclude } from "leadtype/remark";

const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const SRC_DIR = FIXTURE_DIR;
const OUT_DIR = join(process.cwd(), "public-real2");

await rm(OUT_DIR, { recursive: true, force: true });
await convertAllMdx({
  srcDir: SRC_DIR,
  outDir: OUT_DIR,
  remarkPlugins: [remarkInclude, ...defaultRemarkPlugins],
  enrichFrontmatterFromGit: true,
});
process.stdout.write("Conversion done.\n");
