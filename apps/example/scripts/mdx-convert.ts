#!/usr/bin/env bun
/**
 * Reads the package's MDX source at the repo root `/docs` and writes converted
 * markdown into `apps/example/public/docs` for the dev server. This is exactly
 * what an external consumer (e.g. c15t/c15t) would do with their own docs.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertAllMdx, type MdxToMarkdownOptions } from "leadtype/convert";
import {
  defaultRemarkPlugins,
  remarkInclude,
  remarkTypeTableToMarkdown,
} from "leadtype/remark";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const repoRoot = join(appRoot, "..", "..");
const srcDir = join(repoRoot, "docs");
const outDir = join(appRoot, "public", "docs");
const typeTableRemarkPlugin: NonNullable<
  MdxToMarkdownOptions["remarkPlugins"]
>[number] = [remarkTypeTableToMarkdown, { basePath: repoRoot }];
const remarkPlugins: NonNullable<MdxToMarkdownOptions["remarkPlugins"]> = [
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

await convertAllMdx({
  srcDir,
  outDir,
  remarkPlugins,
  enrichFrontmatterFromGit: true,
});
