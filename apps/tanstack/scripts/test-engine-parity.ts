#!/usr/bin/env bun
/**
 * Converts the real c15t fixture with the native markdown pipeline. When
 * LEADTYPE_MARKDOWN_BASELINE_DIR points at a pre-cleanup markdown tree, output
 * must remain byte-identical to that baseline.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { convertAllMdx } from "leadtype/convert";
import { defaultMarkdownTransforms, includeMarkdown } from "leadtype/markdown";

const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const SRC_DIR = join(FIXTURE_DIR, "docs");
const BASELINE_DIR = process.env.LEADTYPE_MARKDOWN_BASELINE_DIR;

if (!existsSync(SRC_DIR)) {
  process.stderr.write(
    "content-fixtures/c15t not found - run `bun run setup:real` first.\n"
  );
  process.exit(1);
}

if (!(BASELINE_DIR && existsSync(BASELINE_DIR))) {
  process.stderr.write(
    "LEADTYPE_MARKDOWN_BASELINE_DIR must point to an existing markdown baseline directory.\n"
  );
  process.exit(1);
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
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
      } else if (entry.name.endsWith(".md")) {
        files.push(relative(dir, full));
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function convertFixture(outDir: string): Promise<void> {
  await convertAllMdx({
    srcDir: SRC_DIR,
    outDir,
    markdownTransforms: [includeMarkdown, ...defaultMarkdownTransforms],
    enrichFrontmatterFromGit: false,
    failOnError: true,
  });
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((item, i) => item === right[i])
  );
}

const tempRoot = await mkdtemp(join(tmpdir(), "leadtype-engine-parity-"));
const nativeOut = join(tempRoot, "native");

try {
  process.stdout.write(
    `Converting c15t docs with native pipeline from ${SRC_DIR}\n`
  );
  await convertFixture(nativeOut);

  const baselineFiles = await listMarkdownFiles(BASELINE_DIR);
  const nativeFiles = await listMarkdownFiles(nativeOut);
  if (!sameList(baselineFiles, nativeFiles)) {
    throw new Error(
      `baseline=${baselineFiles.length} file(s), native=${nativeFiles.length} file(s)`
    );
  }

  for (const relativePath of baselineFiles) {
    const [baselineMarkdown, nativeMarkdown] = await Promise.all([
      readFile(join(BASELINE_DIR, relativePath), "utf8"),
      readFile(join(nativeOut, relativePath), "utf8"),
    ]);
    if (baselineMarkdown !== nativeMarkdown) {
      throw new Error(`output differs for ${relativePath}`);
    }
  }

  process.stdout.write(
    `Native baseline parity passed: ${baselineFiles.length} markdown file(s) match.\n`
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
