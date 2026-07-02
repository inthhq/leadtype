import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { glob as fg } from "tinyglobby";

/**
 * Generated artifacts are read while they are being (re)generated — by
 * concurrent `leadtype generate` runs sharing an outDir, and by sibling build
 * steps (tsc, next build) that read the output directory. A plain `writeFile`
 * truncates the destination first, so those readers can observe empty or
 * half-written files. Writing to a sibling temp file and renaming into place
 * makes every artifact replacement atomic: readers see the old content or the
 * new content, never a partial file.
 *
 * The temp file lives in the same directory as the destination so the rename
 * never crosses a filesystem boundary (rename is only atomic within one).
 * No fsync: these are reproducible build outputs, so crash durability is not
 * worth the per-file cost — concurrent-reader atomicity is the goal.
 */

const TEMP_SUFFIX_BYTES = 6;
// Mirrors tempPathFor: `.{name}.{pid}-{12 hex chars}.tmp`.
const TEMP_FILE_NAME_PATTERN = /^\..+\.\d+-[0-9a-f]{12}\.tmp$/;

function tempPathFor(filePath: string): string {
  const suffix = randomBytes(TEMP_SUFFIX_BYTES).toString("hex");
  return join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}-${suffix}.tmp`
  );
}

/** True when `fileName` matches the temp-sibling naming scheme used here. */
export function isAtomicTempFileName(fileName: string): boolean {
  return TEMP_FILE_NAME_PATTERN.test(fileName);
}

/**
 * Remove temp siblings leaked by a hard-killed run (SIGKILL, OOM kill).
 * Normal and error paths clean up after themselves; this sweep exists so a
 * crashed run cannot leave `.name.pid-hex.tmp` droppings in a directory that
 * is deployed verbatim (e.g. `public/`). Callers must hold the generate lock
 * (or otherwise know no run is in flight) so an active run's in-progress
 * temp files are never swept.
 */
export async function sweepLeakedTempFiles(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    return;
  }
  const candidates = await fg("**/.*.tmp", {
    absolute: true,
    cwd: dir,
    dot: true,
    onlyFiles: true,
  });
  await Promise.all(
    candidates
      .filter((candidate) => isAtomicTempFileName(basename(candidate)))
      .map((candidate) => rm(candidate, { force: true }))
  );
}

async function commitTempFile(
  tempPath: string,
  filePath: string,
  write: () => Promise<void>
): Promise<void> {
  try {
    await write();
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await rm(tempPath, { force: true });
    } catch {
      // Best-effort cleanup; surface the original failure instead.
    }
    throw error;
  }
}

/** Atomically replace `filePath` with `data` (write temp sibling + rename). */
export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array
): Promise<void> {
  const tempPath = tempPathFor(filePath);
  await commitTempFile(tempPath, filePath, () => writeFile(tempPath, data));
}

/** Atomically replace `targetPath` with a copy of `sourcePath`. */
export async function copyFileAtomic(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  const tempPath = tempPathFor(targetPath);
  await commitTempFile(tempPath, targetPath, () =>
    copyFile(sourcePath, tempPath)
  );
}
