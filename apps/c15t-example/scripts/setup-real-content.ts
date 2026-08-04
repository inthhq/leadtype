#!/usr/bin/env bun

/**
 * Opt-in: acquires real c15t content so this repro can run Leadtype against
 * production docs.
 *
 * Acquisition is `leadtype sync`. The source — repository, pinned ref, cache
 * directory, and the sparse paths that keep one docs folder from dragging in a
 * whole monorepo — is declared in `leadtype.config.ts`, so there is no clone
 * logic here to drift from it.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runSyncCommand } from "../../../packages/leadtype/src/cli/sync";

const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");

const code = await runSyncCommand(["--src", process.cwd(), "--refresh"], {
  stderr: process.stderr,
  stdout: process.stdout,
});

if (code !== 0) {
  process.exit(code);
}

if (!existsSync(join(FIXTURE_DIR, "docs", "docs.config.ts"))) {
  process.stderr.write(
    `Sync completed but ${FIXTURE_DIR}/docs/docs.config.ts is missing. ` +
      "Check the `sparse` paths in leadtype.config.ts.\n"
  );
  process.exit(1);
}

process.stdout.write("Real c15t content ready.\n");
