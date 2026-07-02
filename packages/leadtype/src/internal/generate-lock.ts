import { createHash } from "node:crypto";
import { mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Cross-process single-flight lock for `leadtype generate`.
 *
 * Parallel task graphs (lint/typecheck/build each depending on "docs are
 * generated") commonly invoke generation concurrently against the same
 * outDir. Atomic per-file writes keep every individual artifact readable, but
 * whole runs still interleave: one run's read-back of `outDir/docs` can see a
 * mix of its own and another run's output, and both runs burn the same work.
 * This lock serializes runs per outDir so concurrent invocations wait for the
 * in-flight run instead of racing it.
 *
 * The lock lives under os.tmpdir(), keyed by a hash of the resolved outDir —
 * never inside the output directory itself, which is typically deployed
 * verbatim (e.g. `public/`) and must not accumulate lock droppings from
 * crashed runs. `mkdir` without `recursive` is the atomic acquire: exactly
 * one process creates the directory, everyone else gets EEXIST.
 *
 * Stale handling: the holder refreshes the lock directory's mtime on an
 * interval; a lock whose mtime is older than `staleMs` belongs to a crashed
 * run and is reclaimed. Concurrent reclaimers race on the next mkdir and
 * exactly one wins.
 */

const DEFAULT_STALE_MS = 10 * 60 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 150;
const KEEPALIVE_DIVISOR = 4;
const MIN_KEEPALIVE_MS = 1000;
const LOCK_KEY_LENGTH = 16;

export type GenerateLockOptions = {
  /** Age after which an unrefreshed lock is considered abandoned. */
  staleMs?: number;
  /** How long to wait for the holder before failing loudly. */
  waitTimeoutMs?: number;
  /** Delay between acquisition attempts while waiting. */
  pollIntervalMs?: number;
};

export type GenerateLock = {
  lockPath: string;
  release: () => Promise<void>;
};

export function generateLockPath(outDir: string): string {
  const key = createHash("sha256")
    .update(path.resolve(outDir))
    .digest("hex")
    .slice(0, LOCK_KEY_LENGTH);
  return path.join(tmpdir(), `leadtype-generate-${key}.lock`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > staleMs;
  } catch {
    // Lock vanished between EEXIST and stat — the holder released; retry.
    return false;
  }
}

async function tryAcquire(lockPath: string): Promise<boolean> {
  try {
    await mkdir(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

async function writeOwnerMetadata(lockPath: string): Promise<void> {
  try {
    await writeFile(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      })}\n`
    );
  } catch {
    // Diagnostics only — the lock is the directory itself.
  }
}

export async function acquireGenerateLock(
  outDir: string,
  options: GenerateLockOptions = {}
): Promise<GenerateLock> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const lockPath = generateLockPath(outDir);
  const startedAt = Date.now();

  while (!(await tryAcquire(lockPath))) {
    if (await isStale(lockPath, staleMs)) {
      await rm(lockPath, { force: true, recursive: true });
      continue;
    }
    if (Date.now() - startedAt >= waitTimeoutMs) {
      throw new Error(
        `timed out after ${Math.round(waitTimeoutMs / 1000)}s waiting for another \`leadtype generate\` run writing to "${outDir}" ` +
          `(lock: ${lockPath}). If no other run is active, delete the lock directory, ` +
          "or set LEADTYPE_NO_LOCK=1 to skip locking entirely."
      );
    }
    await sleep(pollIntervalMs);
  }

  await writeOwnerMetadata(lockPath);

  // Refresh the lock's mtime so runs longer than staleMs are not reclaimed
  // from under us. unref keeps the interval from holding the process open.
  const keepaliveMs = Math.max(
    MIN_KEEPALIVE_MS,
    Math.floor(staleMs / KEEPALIVE_DIVISOR)
  );
  const keepalive = setInterval(() => {
    const now = new Date();
    utimes(lockPath, now, now).catch(() => {
      // Best-effort refresh; a missed touch only matters past staleMs.
    });
  }, keepaliveMs);
  keepalive.unref();

  let released = false;
  return {
    lockPath,
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      clearInterval(keepalive);
      await rm(lockPath, { force: true, recursive: true });
    },
  };
}
