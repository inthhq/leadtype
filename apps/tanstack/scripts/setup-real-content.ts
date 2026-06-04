#!/usr/bin/env bun

/**
 * Opt-in: shallow-clones c15t into content-fixtures/c15t/ so the real-content
 * test can run the full MDX→MD pipeline against production docs. The sparse
 * checkout includes docs plus package source files referenced by AutoTypeTable.
 * Skipped by default — run via `bun run test:real`.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const REPO = "https://github.com/c15t/c15t.git";
// Pin to a specific ref so bench/test numbers are reproducible. Override with
// C15T_REF=<sha|tag|branch> to test against upstream changes.
const FIXTURE_REF = process.env.C15T_REF ?? "main";
const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const SPARSE_PATHS = ["docs", "packages"] as const;
const execFileAsync = promisify(execFile);

async function runGit(args: string[]): Promise<void> {
  try {
    await execFileAsync("git", args);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `Unknown error: ${String(error)}`;
    throw new Error(`git ${args.join(" ")} failed: ${message}`, {
      cause: error,
    });
  }
}

await mkdir(join(process.cwd(), "content-fixtures"), { recursive: true });

if (existsSync(join(FIXTURE_DIR, ".git"))) {
  process.stdout.write(
    `Updating existing clone at ${FIXTURE_DIR} → ${FIXTURE_REF}\n`
  );
  await runGit([
    "-C",
    FIXTURE_DIR,
    "fetch",
    "--depth=1",
    "origin",
    FIXTURE_REF,
  ]);
  await runGit(["-C", FIXTURE_DIR, "sparse-checkout", "set", ...SPARSE_PATHS]);
  await runGit(["-C", FIXTURE_DIR, "reset", "--hard", "FETCH_HEAD"]);
} else {
  process.stdout.write(`Cloning ${REPO} @ ${FIXTURE_REF} → ${FIXTURE_DIR}\n`);
  await runGit([
    "clone",
    "--depth=1",
    "--filter=blob:none",
    "--sparse",
    REPO,
    FIXTURE_DIR,
  ]);
  await runGit(["-C", FIXTURE_DIR, "sparse-checkout", "set", ...SPARSE_PATHS]);
  await runGit([
    "-C",
    FIXTURE_DIR,
    "fetch",
    "--depth=1",
    "origin",
    FIXTURE_REF,
  ]);
  await runGit(["-C", FIXTURE_DIR, "reset", "--hard", "FETCH_HEAD"]);
}

process.stdout.write("Real content ready.\n");
