#!/usr/bin/env bun
/**
 * Mirrors ~/dev/monorepo/apps/dsar-docs/scripts/tasks/mdx-convert.ts to verify
 * @inth/docs is a drop-in replacement for @inth/optin-docs.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { convertAllMdx } from "@inth/docs/convert";
import { defaultRemarkPlugins, remarkInclude } from "@inth/docs/remark";

const scriptsRoot = process.cwd();
const srcDir = join(scriptsRoot, "content");
const outDir = join(scriptsRoot, "public");

if (!existsSync(srcDir)) {
  process.stderr.write(`Source directory not found: ${srcDir}\n`);
  process.exit(1);
}

process.stdout.write(`Converting MDX from ${srcDir} → ${outDir}\n`);
await convertAllMdx({
  srcDir,
  outDir,
  remarkPlugins: [remarkInclude, ...defaultRemarkPlugins],
  enrichFrontmatterFromGit: true,
});
process.stdout.write("MDX conversion complete\n");
