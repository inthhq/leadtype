#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsRoot, "..", "..", "..");
const sourceRoot = join(repoRoot, ".docs-src", "c15t");
const refresh = process.env.C15T_REFRESH === "1";

const run = (args: string[]) => {
  const result = spawnSync("git", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
};

await mkdir(join(repoRoot, ".docs-src"), { recursive: true });

if (existsSync(join(sourceRoot, ".git"))) {
  if (refresh) {
    run(["-C", sourceRoot, "pull", "--ff-only"]);
  }
  process.stdout.write(`Using c15t source at ${sourceRoot}\n`);
} else {
  run(["clone", "--depth", "1", "https://github.com/c15t/c15t", sourceRoot]);
}
