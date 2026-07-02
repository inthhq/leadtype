import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireGenerateLock, generateLockPath } from "./generate-lock";

const tempDirs: string[] = [];
const lockPaths: string[] = [];

async function createTempOutDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-lock-out-"));
  tempDirs.push(dir);
  lockPaths.push(generateLockPath(dir));
  return dir;
}

afterEach(async () => {
  await Promise.all(
    [...tempDirs.splice(0), ...lockPaths.splice(0)].map((dir) =>
      rm(dir, { force: true, recursive: true })
    )
  );
});

describe("acquireGenerateLock", () => {
  it("acquires, holds, and releases", async () => {
    const outDir = await createTempOutDir();
    const lock = await acquireGenerateLock(outDir);
    expect(existsSync(lock.lockPath)).toBe(true);

    await lock.release();
    expect(existsSync(lock.lockPath)).toBe(false);
    // Release is idempotent.
    await lock.release();
  });

  it("keys the lock by outDir so unrelated runs do not contend", async () => {
    const outDirA = await createTempOutDir();
    const outDirB = await createTempOutDir();
    expect(generateLockPath(outDirA)).not.toBe(generateLockPath(outDirB));

    const lockA = await acquireGenerateLock(outDirA);
    const lockB = await acquireGenerateLock(outDirB, { waitTimeoutMs: 500 });
    await Promise.all([lockA.release(), lockB.release()]);
  });

  it("waits for the holder to release before acquiring", async () => {
    const outDir = await createTempOutDir();
    const first = await acquireGenerateLock(outDir);

    let firstReleased = false;
    const second = acquireGenerateLock(outDir, {
      pollIntervalMs: 20,
      waitTimeoutMs: 5000,
    }).then(async (lock) => {
      expect(firstReleased).toBe(true);
      await lock.release();
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    firstReleased = true;
    await first.release();
    await second;
  });

  it("reclaims a lock whose recorded holder process is dead", async () => {
    const outDir = await createTempOutDir();
    const lockPath = generateLockPath(outDir);
    await mkdir(lockPath);
    // Fresh mtime, but the recorded pid cannot exist (beyond pid_max on
    // Linux and macOS) — models a SIGKILLed/OOM-killed holder.
    await writeFile(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify({ pid: 2 ** 30, acquiredAt: "2026-01-01T00:00:00Z" })}\n`
    );

    const lock = await acquireGenerateLock(outDir, {
      pollIntervalMs: 20,
      staleMs: 60_000,
      waitTimeoutMs: 2000,
    });
    expect(existsSync(lock.lockPath)).toBe(true);
    await lock.release();
  });

  it("registers signal handlers while held and removes them on release", async () => {
    const outDir = await createTempOutDir();
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    const lock = await acquireGenerateLock(outDir);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

    await lock.release();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  it("reclaims a stale lock left by a crashed run", async () => {
    const outDir = await createTempOutDir();
    const lockPath = generateLockPath(outDir);
    await mkdir(lockPath);
    const stale = new Date(Date.now() - 60_000);
    await utimes(lockPath, stale, stale);

    const lock = await acquireGenerateLock(outDir, {
      pollIntervalMs: 20,
      staleMs: 1000,
      waitTimeoutMs: 2000,
    });
    expect(existsSync(lock.lockPath)).toBe(true);
    await lock.release();
  });

  it("fails loudly when the holder never releases", async () => {
    const outDir = await createTempOutDir();
    const holder = await acquireGenerateLock(outDir);
    try {
      await expect(
        acquireGenerateLock(outDir, {
          pollIntervalMs: 20,
          waitTimeoutMs: 200,
        })
      ).rejects.toThrow(/timed out .*leadtype generate/);
    } finally {
      await holder.release();
    }
  });

  it("serializes concurrent acquisitions", async () => {
    const outDir = await createTempOutDir();
    let inCriticalSection = 0;
    let maxInCriticalSection = 0;

    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const lock = await acquireGenerateLock(outDir, {
          pollIntervalMs: 10,
          waitTimeoutMs: 10_000,
        });
        inCriticalSection += 1;
        maxInCriticalSection = Math.max(
          maxInCriticalSection,
          inCriticalSection
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        inCriticalSection -= 1;
        await lock.release();
      })
    );

    expect(maxInCriticalSection).toBe(1);
  });
});
