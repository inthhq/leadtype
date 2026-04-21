#!/usr/bin/env bun
/**
 * Mirrors ~/dev/monorepo/apps/dsar-docs/scripts/tasks/mdx-convert.ts to verify
 * @inth/docs is a drop-in replacement for @inth/optin-docs.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  convertAllMdx,
  type MdxToMarkdownConfig,
} from "../../../packages/docs/src/convert/index.ts";
import {
  defaultRemarkPlugins,
  remarkInclude,
  remarkTypeTableToMarkdown,
} from "../../../packages/docs/src/remark/index.ts";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsRoot, "..", "..");
const appRoot = join(scriptsRoot, "..");
const srcDir = join(appRoot, "content");
const outDir = join(appRoot, "public");
const typeTableRemarkPlugin: NonNullable<
  MdxToMarkdownConfig["remarkPlugins"]
>[number] = [remarkTypeTableToMarkdown, { basePath: repoRoot }];
const remarkPlugins: NonNullable<MdxToMarkdownConfig["remarkPlugins"]> = [
  remarkInclude,
  ...defaultRemarkPlugins.filter(
    (plugin) => plugin !== remarkTypeTableToMarkdown
  ),
  typeTableRemarkPlugin,
];

if (!existsSync(srcDir)) {
  process.stderr.write(`Source directory not found: ${srcDir}\n`);
  process.exit(1);
}

process.stdout.write(`Converting MDX from ${srcDir} → ${outDir}\n`);
await convertAllMdx({
  srcDir,
  outDir,
  remarkPlugins,
  enrichFrontmatterFromGit: true,
});
process.stdout.write("MDX conversion complete\n");
