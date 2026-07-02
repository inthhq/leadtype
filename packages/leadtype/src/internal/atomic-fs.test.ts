import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyFileAtomic,
  isAtomicTempFileName,
  sweepLeakedTempFiles,
  writeFileAtomic,
} from "./atomic-fs";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-atomic-fs-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("writeFileAtomic", () => {
  it("writes new files and replaces existing ones", async () => {
    const dir = await createTempDir();
    const target = path.join(dir, "artifact.txt");

    await writeFileAtomic(target, "first");
    expect(await readFile(target, "utf8")).toBe("first");

    await writeFileAtomic(target, "second");
    expect(await readFile(target, "utf8")).toBe("second");
  });

  it("leaves no temp files behind after writing", async () => {
    const dir = await createTempDir();
    await writeFileAtomic(path.join(dir, "artifact.txt"), "content");
    const entries = await readdir(dir);
    expect(entries).toEqual(["artifact.txt"]);
  });

  it("throws without creating the target when the directory is missing", async () => {
    const dir = await createTempDir();
    const target = path.join(dir, "missing", "artifact.txt");
    await expect(writeFileAtomic(target, "content")).rejects.toThrow();
  });

  it("never exposes partial content to concurrent readers", async () => {
    const dir = await createTempDir();
    const target = path.join(dir, "artifact.txt");
    // Large enough that a non-atomic write would be observable mid-flight.
    const sizeBytes = 4 * 1024 * 1024;
    const payloadA = "a".repeat(sizeBytes);
    const payloadB = "b".repeat(sizeBytes);
    await writeFileAtomic(target, payloadA);

    const rounds = 25;
    const writers = (async () => {
      for (let round = 0; round < rounds; round++) {
        await Promise.all([
          writeFileAtomic(target, payloadA),
          writeFileAtomic(target, payloadB),
        ]);
      }
    })();
    const readers = (async () => {
      for (let round = 0; round < rounds * 4; round++) {
        const seen = await readFile(target, "utf8");
        expect(seen === payloadA || seen === payloadB).toBe(true);
      }
    })();

    await Promise.all([writers, readers]);
  });
});

describe("copyFileAtomic", () => {
  it("replaces the target with a copy of the source", async () => {
    const dir = await createTempDir();
    const source = path.join(dir, "source.txt");
    const target = path.join(dir, "target.txt");
    await writeFile(source, "copied");
    await writeFile(target, "stale");

    await copyFileAtomic(source, target);

    expect(await readFile(target, "utf8")).toBe("copied");
    const entries = await readdir(dir);
    expect(entries.sort()).toEqual(["source.txt", "target.txt"]);
  });

  it("cleans up its temp file when the source is missing", async () => {
    const dir = await createTempDir();
    const target = path.join(dir, "target.txt");
    await expect(
      copyFileAtomic(path.join(dir, "missing.txt"), target)
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("isAtomicTempFileName", () => {
  it("matches only the temp-sibling naming scheme", () => {
    expect(isAtomicTempFileName(".guide.md.12345-a1b2c3d4e5f6.tmp")).toBe(true);
    // User dotfiles and near-misses must never match — the sweep deletes.
    expect(isAtomicTempFileName(".gitkeep")).toBe(false);
    expect(isAtomicTempFileName(".env.tmp")).toBe(false);
    expect(isAtomicTempFileName("guide.md.12345-a1b2c3d4e5f6.tmp")).toBe(false);
    expect(isAtomicTempFileName(".guide.md.12345-short.tmp")).toBe(false);
  });
});

describe("sweepLeakedTempFiles", () => {
  it("removes leaked temp siblings but leaves everything else", async () => {
    const dir = await createTempDir();
    await mkdir(path.join(dir, "docs", "guides"), { recursive: true });
    const leaked = path.join(
      dir,
      "docs",
      "guides",
      ".page.md.99999-abcdef012345.tmp"
    );
    const artifact = path.join(dir, "docs", "guides", "page.md");
    const dotfile = path.join(dir, "docs", ".gitkeep");
    await writeFile(leaked, "partial");
    await writeFile(artifact, "content");
    await writeFile(dotfile, "");

    await sweepLeakedTempFiles(dir);

    expect(await readdir(path.join(dir, "docs", "guides"))).toEqual([
      "page.md",
    ]);
    expect(await readFile(artifact, "utf8")).toBe("content");
    expect(await readdir(path.join(dir, "docs"))).toContain(".gitkeep");
  });

  it("is a no-op for a missing directory", async () => {
    const dir = await createTempDir();
    await expect(
      sweepLeakedTempFiles(path.join(dir, "missing"))
    ).resolves.toBeUndefined();
  });
});
