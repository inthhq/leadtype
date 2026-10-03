#!/usr/bin/env bun

/**
 * Audit the production build against the Vercel agent-readability spec.
 *
 * Serves the built output with `vite preview` and runs
 * `@vercel/agent-readability` against it. Always audit the production
 * server: under `vite dev`, root-level `.md` paths (like /sitemap.md) are
 * intercepted by the MDX plugin before the agent-readability middleware
 * runs, and the portless TLS cert makes every check fail with status 0.
 *
 * Known false positive: TanStack Router's inline scroll-restoration script
 * reads `window.location.hash`, which the CLI's redirect heuristic flags as
 * a "JavaScript redirect" (~3 points). The default threshold accounts for it.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const port = Number(process.env.AUDIT_PORT ?? 4178);
const minScore = process.env.AUDIT_MIN_SCORE ?? "90";
const baseUrl = `http://localhost:${port}/`;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

const preview = spawn(
  "bun",
  ["x", "vite", "preview", "--port", String(port), "--strictPort"],
  { stdio: ["ignore", "ignore", "inherit"] }
);

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) {
      throw new Error(
        `vite preview exited with code ${preview.exitCode} before serving — is port ${port} free?`
      );
    }
    try {
      const response = await fetch(`${baseUrl}llms.txt`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not accepting connections yet.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`vite preview did not serve ${baseUrl} within 30s.`);
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
}

let exitCode = 1;
try {
  await waitForServer();
  const audit = spawn(
    "bun",
    [
      "x",
      "@vercel/agent-readability",
      "audit",
      baseUrl,
      "--min-score",
      minScore,
      // Pass through extra flags, e.g. `bun run audit --json`.
      ...process.argv.slice(2),
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  exitCode = await waitForExit(audit);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
} finally {
  preview.kill();
}

process.exit(exitCode);
