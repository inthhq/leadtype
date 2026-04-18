#!/usr/bin/env bun
/**
 * Opt-in: shallow-clones c15t into content-fixtures/c15t/ so the real-content
 * test can run the full MDX→MD pipeline against production docs. Skipped by
 * default — run via `bun run test:real`.
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const REPO = "https://github.com/c15t/c15t.git";
// Pin to a specific ref so bench/test numbers are reproducible. Override with
// C15T_REF=<sha|tag|branch> to test against upstream changes.
const FIXTURE_REF = process.env.C15T_REF ?? "main";
const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");

await mkdir(join(process.cwd(), "content-fixtures"), { recursive: true });

if (existsSync(join(FIXTURE_DIR, ".git"))) {
  process.stdout.write(
    `Updating existing clone at ${FIXTURE_DIR} → ${FIXTURE_REF}\n`
  );
  await $`git -C ${FIXTURE_DIR} fetch --depth=1 origin ${FIXTURE_REF}`.quiet();
  await $`git -C ${FIXTURE_DIR} reset --hard FETCH_HEAD`.quiet();
} else {
  process.stdout.write(`Cloning ${REPO} @ ${FIXTURE_REF} → ${FIXTURE_DIR}\n`);
  await $`git clone --depth=1 --filter=blob:none --sparse ${REPO} ${FIXTURE_DIR}`.quiet();
  await $`git -C ${FIXTURE_DIR} sparse-checkout set docs`.quiet();
  await $`git -C ${FIXTURE_DIR} fetch --depth=1 origin ${FIXTURE_REF}`.quiet();
  await $`git -C ${FIXTURE_DIR} reset --hard FETCH_HEAD`.quiet();
}

process.stdout.write("Real content ready.\n");
