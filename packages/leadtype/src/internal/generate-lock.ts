import { createHash, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
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
 * Abandoned-lock recovery, ordered by how fast each path fires:
 * 1. SIGINT/SIGTERM: the holder removes its lock on the way out, so an
 *    interrupted run never stalls the next one.
 * 2. Dead holder (SIGKILL, OOM kill): waiters probe the pid recorded in
 *    `owner.json` — the lock lives in the local tmpdir, so the holder is
 *    always a same-machine process — and reclaim as soon as it is gone.
 * 3. Stale mtime: the holder refreshes the lock's mtime on an interval; a
 *    lock older than `staleMs` is reclaimed even when no pid is readable.
 */

const DEFAULT_STALE_MS = 10 * 60 * 1000;
// Longer than the stale window so a waiter always outlives a crashed holder
// (the lock goes stale and is reclaimed before any waiter gives up), while a
// healthy long-running holder — whose keepalive keeps the lock fresh — is
// waited on rather than failed.
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 150;
const KEEPALIVE_DIVISOR = 4;
const MIN_KEEPALIVE_MS = 1000;
const LOCK_KEY_LENGTH = 16;
const RECLAIM_SUFFIX_BYTES = 4;

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

/**
 * Lock paths currently held by this process. The lock is not reentrant (a
 * second acquire would wait on our own mkdir until timeout), so callers that
 * may run inside an already-locked `leadtype generate` — e.g. `convertAllMdx`
 * with `prune` — check this before acquiring.
 */
const heldLockPaths = new Set<string>();

export function isGenerateLockHeld(outDir: string): boolean {
  return heldLockPaths.has(generateLockPath(outDir));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readOwnerPid(lockPath: string): Promise<number | undefined> {
  try {
    const raw = await readFile(path.join(lockPath, "owner.json"), "utf8");
    const pid = (JSON.parse(raw) as { pid?: unknown }).pid;
    return typeof pid === "number" ? pid : undefined;
  } catch {
    // Holder mid-acquire or metadata unreadable — fall back to the mtime window.
    return;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function isAbandoned(
  lockPath: string,
  staleMs: number
): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > staleMs) {
      return true;
    }
  } catch {
    // Lock vanished between EEXIST and stat — the holder released; retry.
    return false;
  }
  const pid = await readOwnerPid(lockPath);
  return pid !== undefined && !isProcessAlive(pid);
}

/**
 * Remove an abandoned lock without racing competing acquirers: rename it to a
 * unique trash path first (rename is atomic, so exactly one reclaimer wins),
 * then re-check that what we grabbed really was the abandoned lock. A plain
 * `rm` here could delete a fresh lock that a competing process created
 * between our abandonment check and the removal.
 */
async function reclaimAbandonedLock(
  lockPath: string,
  staleMs: number
): Promise<void> {
  const suffix = randomBytes(RECLAIM_SUFFIX_BYTES).toString("hex");
  const trashPath = `${lockPath}.reclaim-${process.pid}-${suffix}`;
  try {
    await rename(lockPath, trashPath);
  } catch {
    // Another reclaimer won, or the holder released — go retry the acquire.
    return;
  }
  if (await isAbandoned(trashPath, staleMs)) {
    await rm(trashPath, { force: true, recursive: true });
    return;
  }
  // We grabbed a live lock created in the check→rename window; hand it back.
  try {
    await rename(trashPath, lockPath);
  } catch {
    // A third process acquired lockPath in the same window. Dropping the
    // displaced lock is the least-bad option: the window is microseconds
    // wide, and the displaced run's artifacts remain safe under the atomic
    // per-file writes.
    await rm(trashPath, { force: true, recursive: true });
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
    // Waiters fall back to the mtime stale window without a readable pid.
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
    if (await isAbandoned(lockPath, staleMs)) {
      await reclaimAbandonedLock(lockPath, staleMs);
      continue;
    }
    if (Date.now() - startedAt >= waitTimeoutMs) {
      throw new Error(
        `timed out after ${Math.round(waitTimeoutMs / 1000)}s waiting for another \`leadtype generate\` run writing to "${outDir}" ` +
          `(lock: ${lockPath}). If no other run is active, delete the lock directory. ` +
          "Set LEADTYPE_LOCK_TIMEOUT_MS to wait longer, or LEADTYPE_NO_LOCK=1 to skip locking entirely."
      );
    }
    await sleep(pollIntervalMs);
  }

  // An interrupted holder must not stall the next run until a slower
  // recovery path fires, so release the lock on the way out and re-raise to
  // preserve the default terminate behavior and exit code.
  const onSigint = (): void => releaseOnSignal("SIGINT");
  const onSigterm = (): void => releaseOnSignal("SIGTERM");
  const removeSignalHandlers = (): void => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  };
  const releaseOnSignal = (signal: NodeJS.Signals): void => {
    try {
      rmSync(lockPath, { force: true, recursive: true });
    } catch {
      // Best effort — the dead-pid reclaim covers whatever we couldn't remove.
    }
    removeSignalHandlers();
    process.kill(process.pid, signal);
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  await writeOwnerMetadata(lockPath);
  heldLockPaths.add(lockPath);

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
      removeSignalHandlers();
      heldLockPaths.delete(lockPath);
      await rm(lockPath, { force: true, recursive: true });
    },
  };
}
