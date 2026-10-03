#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentReadabilityManifest } from "leadtype/llm/readability";
import {
  appRoot,
  baseUrl,
  generatedDir,
  outDir,
  packageRoot,
  repoRoot,
} from "./docs-project";

const child = spawn(
  process.execPath,
  [
    join(packageRoot, "dist", "cli.js"),
    "generate",
    "--src",
    repoRoot,
    "--out",
    outDir,
    "--base-url",
    baseUrl,
  ],
  { cwd: appRoot, stdio: "inherit" }
);
await new Promise<void>((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`Docs generation failed: ${signal ?? code}`));
    }
  });
});

await mkdir(generatedDir, { recursive: true });
const manifest: AgentReadabilityManifest = JSON.parse(
  await readFile(join(outDir, "docs", "agent-readability.json"), "utf8")
);
await writeFile(
  join(generatedDir, "docs-nav.json"),
  `${JSON.stringify(manifest.navigation, null, 2)}\n`
);
for (const [source, target] of [
  ["agent-readability.json", "agent-readability.json"],
  ["search-index.json", "docs-search-index.json"],
  ["search-content.json", "docs-search-content.json"],
  ["redirects.json", "redirects.json"],
] as const) {
  await copyFile(join(outDir, "docs", source), join(generatedDir, target));
}

// Middleware serves these with the request origin. Static copies would mask it.
await Promise.all(
  ["sitemap.xml", "sitemap.md", "robots.txt"].map((file) =>
    rm(join(outDir, file), { force: true })
  )
);
