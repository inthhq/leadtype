#!/usr/bin/env bun
/**
 * Converts the real c15t fixture with both markdown parsers and requires
 * byte-identical markdown output. Git enrichment stays off so metadata does not
 * hide parser differences behind timestamps/authors.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { convertAllMdx } from "leadtype/convert";
import {
  defaultMarkdownTransforms,
  includeMarkdown,
  legacyDefaultMarkdownTransforms,
} from "leadtype/markdown";

type MarkdownEngine = "remark" | "satteri";

const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const SRC_DIR = join(FIXTURE_DIR, "docs");

if (!existsSync(SRC_DIR)) {
  process.stderr.write(
    "content-fixtures/c15t not found - run `bun run setup:real` first.\n"
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

async function convertFixture(
  engine: MarkdownEngine,
  outDir: string
): Promise<void> {
  await convertAllMdx({
    srcDir: SRC_DIR,
    outDir,
    markdownTransforms: [
      includeMarkdown,
      ...(engine === "remark"
        ? legacyDefaultMarkdownTransforms
        : defaultMarkdownTransforms),
    ],
    enrichFrontmatterFromGit: false,
    markdownEngine: engine,
    failOnError: true,
  });
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((item, i) => item === right[i])
  );
}

const tempRoot = await mkdtemp(join(tmpdir(), "leadtype-engine-parity-"));
const remarkOut = join(tempRoot, "remark");
const satteriOut = join(tempRoot, "satteri");

try {
  process.stdout.write(`Converting c15t docs with remark from ${SRC_DIR}\n`);
  await convertFixture("remark", remarkOut);
  process.stdout.write("Converting c15t docs with satteri\n");
  await convertFixture("satteri", satteriOut);

  const remarkFiles = await listMarkdownFiles(remarkOut);
  const satteriFiles = await listMarkdownFiles(satteriOut);
  if (!sameList(remarkFiles, satteriFiles)) {
    throw new Error(
      `remark=${remarkFiles.length} file(s), satteri=${satteriFiles.length} file(s)`
    );
  }

  for (const relativePath of remarkFiles) {
    const [remarkMarkdown, satteriMarkdown] = await Promise.all([
      readFile(join(remarkOut, relativePath), "utf8"),
      readFile(join(satteriOut, relativePath), "utf8"),
    ]);
    if (remarkMarkdown !== satteriMarkdown) {
      throw new Error(`output differs for ${relativePath}`);
    }
  }

  process.stdout.write(
    `Engine parity passed: ${remarkFiles.length} markdown file(s) match.\n`
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
