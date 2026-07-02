import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Incremental conversion cache for `convertAllMdx`.
 *
 * The manifest records, per converted MDX file, everything that influenced
 * its output: the source content hash, the content hashes of every file the
 * conversion read along the way (includes, type-table sources), and the git
 * enrichment that was written into the frontmatter. A file is skipped on the
 * next run only when all of those match and the previous output still exists.
 *
 * A build-wide `fingerprint` (leadtype version + docs-config hash + relevant
 * options) guards everything the per-file inputs can't see — config-defined
 * transformers and flatteners are functions, so the config file's content
 * hash stands in for them.
 */

export const CONVERT_CACHE_VERSION = 1;

export type ConvertCacheEntry = {
  /** sha256 of the raw MDX source. */
  sourceHash: string;
  /** Absolute dependency path → sha256 of its content at conversion time. */
  deps: Record<string, string>;
  /** Serialized git enrichment applied to the output frontmatter. */
  enrichment: string;
  /** Output path relative to the conversion `outDir`. */
  output: string;
};

export type ConvertCacheManifest = {
  version: typeof CONVERT_CACHE_VERSION;
  fingerprint: string;
  /** Keyed by docs-relative POSIX path of the source MDX file. */
  entries: Record<string, ConvertCacheEntry>;
};

export type ConvertCacheOptions = {
  /** Manifest file location, e.g. node_modules/.cache/leadtype/<id>.json. */
  file: string;
  /** Build-wide fingerprint; any mismatch invalidates every entry. */
  fingerprint: string;
  /** Ignore prior entries and rebuild everything (still writes a manifest). */
  force?: boolean;
};

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Hash a file's content, memoizing per run so shared dependencies (a snippet
 * included by many pages) are read once. Returns null for unreadable files so
 * a missing dependency simply invalidates the entries that recorded it.
 */
export type FileHashCache = Map<string, Promise<string | null>>;

export function createFileHashCache(): FileHashCache {
  return new Map();
}

export function hashFileCached(
  filePath: string,
  cache: FileHashCache
): Promise<string | null> {
  const cached = cache.get(filePath);
  if (cached) {
    return cached;
  }
  const pending = readFile(filePath)
    .then((content) => hashContent(content))
    .catch(() => null);
  cache.set(filePath, pending);
  return pending;
}

function isManifestShape(value: unknown): value is ConvertCacheManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const manifest = value as Record<string, unknown>;
  return (
    manifest.version === CONVERT_CACHE_VERSION &&
    typeof manifest.fingerprint === "string" &&
    typeof manifest.entries === "object" &&
    manifest.entries !== null
  );
}

/**
 * Read a manifest, returning null when it's missing, unreadable, from a
 * different cache version, or built with a different fingerprint — every
 * miss degrades to a full rebuild, never an error.
 */
export async function loadConvertCacheManifest(
  filePath: string,
  fingerprint: string
): Promise<ConvertCacheManifest | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isManifestShape(parsed) && parsed.fingerprint === fingerprint) {
      return parsed;
    }
  } catch {
    // Corrupt manifest — treat as absent.
  }
  return null;
}

export async function saveConvertCacheManifest(
  filePath: string,
  manifest: ConvertCacheManifest
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a truncated manifest
  // that silently disables caching on every subsequent run.
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(manifest));
  await rename(tempPath, filePath);
}

/**
 * Check whether every recorded dependency still hashes to the value captured
 * at conversion time. Dependency paths are recorded as real source paths
 * (staged-mirror temp paths are mapped back before recording), so they stay
 * valid across runs.
 */
export async function depsUnchanged(
  deps: Record<string, string>,
  hashCache: FileHashCache
): Promise<boolean> {
  const checks = await Promise.all(
    Object.entries(deps).map(async ([depPath, expectedHash]) => {
      const actualHash = await hashFileCached(depPath, hashCache);
      return actualHash === expectedHash;
    })
  );
  return checks.every(Boolean);
}
