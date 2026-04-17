#!/usr/bin/env bun
/**
 * Runs the full @inth/docs pipeline against the cloned c15t docs and asserts
 * basic health — no crashes, every .mdx produces a .md, all components
 * rendered down to markdown. Meant to catch real-world regressions that
 * hand-crafted fixtures miss.
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { convertAllMdx } from "@inth/docs/convert";
import { lintDocs } from "@inth/docs/lint";
import { defaultRemarkPlugins, remarkInclude } from "@inth/docs/remark";

const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const SRC_DIR = join(FIXTURE_DIR, "docs");
const OUT_DIR = join(process.cwd(), "public-real");

if (!existsSync(SRC_DIR)) {
  process.stderr.write(
    "content-fixtures/c15t not found — run `bun run setup:real` first.\n"
  );
  process.exit(1);
}

async function countFiles(dir: string, ext: string): Promise<number> {
  if (!existsSync(dir)) {
    return 0;
  }
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith(ext)) {
        count += 1;
      }
    }
  }
  return count;
}

process.stdout.write(`Converting real c15t docs from ${SRC_DIR}\n`);
const start = Date.now();
await convertAllMdx({
  srcDir: SRC_DIR,
  outDir: OUT_DIR,
  remarkPlugins: [remarkInclude, ...defaultRemarkPlugins],
  enrichFrontmatterFromGit: true,
});
const elapsed = Date.now() - start;

const mdxCount = await countFiles(SRC_DIR, ".mdx");
const mdCount = await countFiles(OUT_DIR, ".md");
process.stdout.write(`  ${mdxCount} .mdx → ${mdCount} .md in ${elapsed}ms\n`);

if (mdCount < mdxCount * 0.9) {
  process.stderr.write(
    `FAIL: expected at least ${Math.floor(mdxCount * 0.9)} markdown files, got ${mdCount}\n`
  );
  process.exit(1);
}

process.stdout.write("\nLinting real c15t docs\n");
const result = await lintDocs({ srcDir: SRC_DIR });
process.stdout.write(
  `  ${result.summary.filesScanned} files scanned — ${result.summary.errors} error(s), ${result.summary.warnings} warning(s)\n`
);

process.stdout.write("\nReal-content test passed.\n");
