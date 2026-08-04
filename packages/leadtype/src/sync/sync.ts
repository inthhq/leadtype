import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../internal/atomic-fs";
import { normalizeUrlPrefix } from "../internal/docs-url";
import type { DocsCollection } from "../llm";

export type SyncMode = "missing" | "auto" | "refresh" | "offline";

export type SyncManifest = {
  version: 1;
  repository: string;
  ref: string;
  commit: string;
  syncedAt: string;
  /**
   * Sparse paths this checkout was created with. Recorded so a cache built for
   * a different path set is re-cloned rather than reused — a checkout missing
   * `packages/` looks identical to a complete one until a type table fails to
   * resolve.
   */
  sparse?: string[];
};

export type GitRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GitRunner = (
  args: string[],
  options?: { cwd?: string }
) => Promise<GitRunResult>;

export const SYNC_MANIFEST_FILE = ".leadtype-sync.json";

// Git allows abbreviating a commit SHA to 7+ hex characters; full SHAs are 40.
const MIN_SHA_LENGTH = 7;
const MAX_SHA_LENGTH = 40;
const SHA_PATTERN = new RegExp(
  `^[0-9a-f]{${MIN_SHA_LENGTH},${MAX_SHA_LENGTH}}$`,
  "i"
);
const HTTPS_GIT_URL = /^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i;
const SCP_LIKE_GIT_URL = /^(?:[\w.-]+@)?([^:]+):(.+?)(?:\.git)?$/;
const SAFE_SLUG = /[^a-zA-Z0-9_.-]/g;
const GIT_REPOSITORY_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_QUARANTINE_PATH",
  "GIT_WORK_TREE",
] as const;

export function isShaRef(ref: string): boolean {
  return SHA_PATTERN.test(ref);
}

/** Derive a filesystem-safe slug from a repository URL. */
export function repositorySlug(repository: string): string {
  let pathPart: string | undefined;
  const httpsMatch = HTTPS_GIT_URL.exec(repository);
  if (httpsMatch) {
    pathPart = httpsMatch[2];
  } else {
    const scpMatch = SCP_LIKE_GIT_URL.exec(repository);
    if (scpMatch) {
      pathPart = scpMatch[2];
    }
  }
  const base = (pathPart ?? repository).replace(/\.git$/i, "");
  return base.replace(SAFE_SLUG, "-");
}

function gitSubprocessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of GIT_REPOSITORY_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

export type ResolvedRemoteSource = {
  repository: string;
  ref: string;
  cacheDir: string;
  /** Repository-root-relative paths the checkout is limited to. */
  sparse?: string[];
  /** All collection keys that consume this source. */
  collectionKeys: string[];
};

export type ResolvedCollection = {
  key: string;
  collection: DocsCollection;
  /** Set only for remote collections. */
  remote?: ResolvedRemoteSource;
  /** Absolute directory containing the MDX. */
  absoluteDir: string;
  /** URL prefix where this collection is exposed. */
  urlPrefix: string;
};

/**
 * Default cache directory layout for a remote source. Returns a path that
 * still needs to be `path.resolve`d against the config directory.
 */
export function defaultCacheDir(repository: string, ref: string): string {
  return path.join(
    ".leadtype",
    "sources",
    `${repositorySlug(repository)}@${ref}`
  );
}

/** Resolve a single collection's absolute directory and URL prefix. */
export function resolveCollection(
  key: string,
  collection: DocsCollection,
  configDir: string
): ResolvedCollection {
  const urlPrefix = normalizeUrlPrefix(collection.routePrefix ?? `/${key}`);
  if (!collection.repository) {
    return {
      key,
      collection,
      absoluteDir: path.resolve(configDir, collection.dir),
      urlPrefix,
    };
  }
  const ref = collection.ref ?? "main";
  const cacheDir = path.resolve(
    configDir,
    collection.cacheDir ?? defaultCacheDir(collection.repository, ref)
  );
  return {
    key,
    collection,
    remote: {
      repository: collection.repository,
      ref,
      cacheDir,
      ...(collection.sparse && collection.sparse.length > 0
        ? { sparse: collection.sparse }
        : {}),
      collectionKeys: [key],
    },
    absoluteDir: path.resolve(cacheDir, collection.dir),
    urlPrefix,
  };
}

export function resolveAllCollections(
  collections: Record<string, DocsCollection>,
  configDir: string
): ResolvedCollection[] {
  return Object.entries(collections).map(([key, collection]) =>
    resolveCollection(key, collection, configDir)
  );
}

/**
 * Do two path sets describe the same checkout? Order is irrelevant to git
 * sparse-checkout, so this compares as sets. Exported because any consumer
 * reading a cache has to accept exactly what `sync` would accept — a checkout
 * narrower than the config asks for looks complete until something outside the
 * selected paths fails to resolve.
 */
export function sameSparse(
  left: string[] | undefined,
  right: string[] | undefined
): boolean {
  if (!(left || right)) {
    return true;
  }
  if (!(left && right) || left.length !== right.length) {
    return false;
  }
  // Order is irrelevant to git sparse-checkout, so compare as sets.
  const sorted = (paths: string[]) => [...paths].sort();
  return sorted(left).every((value, index) => value === sorted(right)[index]);
}

/** Render a path set for diagnostics, naming the full-repository case. */
export function formatSparse(paths: string[] | undefined): string {
  return paths ? `[${paths.join(", ")}]` : "the full repository";
}

/**
 * Walk collections, derive a deduped list of unique remote sources by
 * `(repository, ref)`. Two collections targeting the same repo/ref share one
 * entry whose `collectionKeys` lists both keys. Errors if two collections
 * specify different `cacheDir` values for the same `(repository, ref)` pair.
 */
export function resolveRemoteSources(
  collections: Record<string, DocsCollection>,
  configDir: string
): ResolvedRemoteSource[] {
  const byRepoRef = new Map<string, ResolvedRemoteSource>();
  for (const resolved of resolveAllCollections(collections, configDir)) {
    if (!resolved.remote) {
      continue;
    }
    const repoRefKey = `${resolved.remote.repository}#${resolved.remote.ref}`;
    const existing = byRepoRef.get(repoRefKey);
    if (existing) {
      if (existing.cacheDir !== resolved.remote.cacheDir) {
        throw new Error(
          `Collections [${existing.collectionKeys.join(", ")}] and "${resolved.key}" target ${resolved.remote.repository}@${resolved.remote.ref} but specify different cacheDir values ("${existing.cacheDir}" vs "${resolved.remote.cacheDir}"). Make them match or remove the explicit cacheDir.`
        );
      }
      // One checkout can only have one path set. Silently taking the first
      // would leave the other collection reading a directory that isn't there.
      if (!sameSparse(existing.sparse, resolved.remote.sparse)) {
        throw new Error(
          `Collections [${existing.collectionKeys.join(", ")}] and "${resolved.key}" target ${resolved.remote.repository}@${resolved.remote.ref} but specify different sparse paths (${formatSparse(existing.sparse)} vs ${formatSparse(resolved.remote.sparse)}). One checkout has one path set — make them match, or list every path both collections need.`
        );
      }
      existing.collectionKeys.push(resolved.key);
      continue;
    }
    byRepoRef.set(repoRefKey, { ...resolved.remote });
  }
  return [...byRepoRef.values()];
}

export async function readSyncManifest(
  cacheDir: string
): Promise<SyncManifest | null> {
  const file = path.join(cacheDir, SYNC_MANIFEST_FILE);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<SyncManifest>;
    if (
      parsed.version !== 1 ||
      typeof parsed.repository !== "string" ||
      typeof parsed.ref !== "string" ||
      typeof parsed.commit !== "string" ||
      typeof parsed.syncedAt !== "string"
    ) {
      return null;
    }
    if (
      parsed.sparse !== undefined &&
      !(
        Array.isArray(parsed.sparse) &&
        parsed.sparse.every((entry) => typeof entry === "string")
      )
    ) {
      return null;
    }
    return parsed as SyncManifest;
  } catch {
    return null;
  }
}

export async function writeSyncManifest(
  cacheDir: string,
  manifest: SyncManifest
): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  await writeFileAtomic(
    path.join(cacheDir, SYNC_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

export const defaultGitRunner: GitRunner = (args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: options?.cwd,
      env: gitSubprocessEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });

/**
 * Wrap a {@link GitRunner} call and translate well-known runtime errors into
 * actionable messages. The most common one is `ENOENT` when the `git` binary
 * is missing from `PATH`; without this, users see a cryptic stack trace.
 */
async function runGit(
  runner: GitRunner,
  args: string[],
  options?: { cwd?: string }
): Promise<GitRunResult> {
  try {
    return await runner(args, options);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        "`git` is not installed or not on PATH. Install git (https://git-scm.com/downloads) to use `leadtype sync`."
      );
    }
    throw err;
  }
}

function gitError(
  action: string,
  source: ResolvedRemoteSource,
  result: GitRunResult
): Error {
  const detail =
    result.stderr.trim() ||
    result.stdout.trim() ||
    `exit code ${result.exitCode}`;
  return new Error(
    `git ${action} failed for ${source.repository}@${source.ref}: ${detail}`
  );
}

async function readHeadCommit(
  cacheDir: string,
  runner: GitRunner
): Promise<string> {
  const result = await runGit(runner, ["rev-parse", "HEAD"], { cwd: cacheDir });
  if (result.exitCode !== 0) {
    throw new Error(
      `git rev-parse HEAD failed in ${cacheDir}: ${result.stderr.trim() || "unknown error"}`
    );
  }
  return result.stdout.trim();
}

/**
 * Apply the source's path set to an existing checkout. Sparse paths are
 * repository-root-relative and passed after `--`, so a path beginning with `-`
 * can't be read as a flag.
 */
async function applySparsePaths(
  source: ResolvedRemoteSource,
  runner: GitRunner
): Promise<void> {
  if (!source.sparse || source.sparse.length === 0) {
    return;
  }
  const result = await runGit(
    runner,
    ["sparse-checkout", "set", "--", ...source.sparse],
    { cwd: source.cacheDir }
  );
  if (result.exitCode !== 0) {
    throw gitError(
      `sparse-checkout set ${source.sparse.join(" ")}`,
      source,
      result
    );
  }
}

async function cloneRemote(
  source: ResolvedRemoteSource,
  runner: GitRunner
): Promise<string> {
  await mkdir(path.dirname(source.cacheDir), { recursive: true });
  if (existsSync(source.cacheDir)) {
    await rm(source.cacheDir, { recursive: true, force: true });
  }

  // A sparse clone is blobless and checks out nothing up front: the paths are
  // selected after cloning, so git only ever fetches the blobs behind them.
  // That is the difference between pulling one docs directory and pulling an
  // entire monorepo to read it.
  const sparseFlags =
    source.sparse && source.sparse.length > 0
      ? ["--filter=blob:none", "--sparse"]
      : [];

  // The `--` end-of-options separator stops git from parsing the user-supplied
  // `repository` URL as a flag (a malicious config like `--upload-pack=…`
  // would otherwise be interpreted as a clone option). `source.ref` is already
  // rejected at config-load time when it begins with `-`.
  if (isShaRef(source.ref)) {
    const cloneResult = await runGit(runner, [
      "clone",
      ...sparseFlags,
      "--",
      source.repository,
      source.cacheDir,
    ]);
    if (cloneResult.exitCode !== 0) {
      throw gitError("clone", source, cloneResult);
    }
    await applySparsePaths(source, runner);
    const checkoutResult = await runGit(runner, ["checkout", source.ref], {
      cwd: source.cacheDir,
    });
    if (checkoutResult.exitCode !== 0) {
      throw gitError(`checkout ${source.ref}`, source, checkoutResult);
    }
  } else {
    const cloneResult = await runGit(runner, [
      "clone",
      "--depth",
      "1",
      ...sparseFlags,
      "--branch",
      source.ref,
      "--",
      source.repository,
      source.cacheDir,
    ]);
    if (cloneResult.exitCode !== 0) {
      throw gitError(`clone --branch ${source.ref}`, source, cloneResult);
    }
    await applySparsePaths(source, runner);
  }

  return readHeadCommit(source.cacheDir, runner);
}

async function fastForwardExisting(
  source: ResolvedRemoteSource,
  runner: GitRunner
): Promise<string> {
  await applySparsePaths(source, runner);
  if (isShaRef(source.ref)) {
    const fetchResult = await runGit(runner, ["fetch", "origin"], {
      cwd: source.cacheDir,
    });
    if (fetchResult.exitCode !== 0) {
      throw gitError("fetch origin", source, fetchResult);
    }
    const checkoutResult = await runGit(runner, ["checkout", source.ref], {
      cwd: source.cacheDir,
    });
    if (checkoutResult.exitCode !== 0) {
      throw gitError(`checkout ${source.ref}`, source, checkoutResult);
    }
  } else {
    const fetchResult = await runGit(
      runner,
      ["fetch", "--depth", "1", "origin", source.ref],
      { cwd: source.cacheDir }
    );
    if (fetchResult.exitCode !== 0) {
      throw gitError(`fetch ${source.ref}`, source, fetchResult);
    }
    const resetResult = await runGit(
      runner,
      ["reset", "--hard", "FETCH_HEAD"],
      {
        cwd: source.cacheDir,
      }
    );
    if (resetResult.exitCode !== 0) {
      throw gitError("reset --hard FETCH_HEAD", source, resetResult);
    }
  }
  return readHeadCommit(source.cacheDir, runner);
}

export type SyncStatus = "fresh" | "cached" | "refreshed";

export type SyncSourceResult = {
  source: ResolvedRemoteSource;
  status: SyncStatus;
  commit: string;
};

export type SyncResult = {
  sources: SyncSourceResult[];
  /** Sources excluded by `repoFilter`. */
  skipped: ResolvedRemoteSource[];
};

export type SyncCollectionsOptions = {
  mode: SyncMode;
  configDir: string;
  collections: Record<string, DocsCollection>;
  runner?: GitRunner;
  /** Substring filter on repository URL. */
  repoFilter?: string;
};

export async function syncCollections(
  opts: SyncCollectionsOptions
): Promise<SyncResult> {
  const runner = opts.runner ?? defaultGitRunner;
  const allSources = resolveRemoteSources(opts.collections, opts.configDir);
  const filter = opts.repoFilter;
  const sources = filter
    ? allSources.filter((s) => s.repository.includes(filter))
    : allSources;
  const skipped = filter
    ? allSources.filter((s) => !s.repository.includes(filter))
    : [];

  const results: SyncSourceResult[] = [];
  for (const source of sources) {
    results.push(await syncOne(source, opts.mode, runner));
  }
  return { sources: results, skipped };
}

async function syncOne(
  source: ResolvedRemoteSource,
  mode: SyncMode,
  runner: GitRunner
): Promise<SyncSourceResult> {
  const hasCheckout = existsSync(path.join(source.cacheDir, ".git"));
  const manifest = hasCheckout ? await readSyncManifest(source.cacheDir) : null;
  // A checkout built for a different path set is not a usable cache: one
  // missing directory looks exactly like a complete clone until something
  // outside the docs tree fails to resolve.
  const manifestMatches =
    manifest !== null &&
    manifest.repository === source.repository &&
    manifest.ref === source.ref &&
    sameSparse(manifest.sparse, source.sparse);

  if (mode === "missing") {
    if (!(hasCheckout && manifestMatches)) {
      throw new Error(
        `source not synced for collection(s) [${source.collectionKeys.join(", ")}]: ${source.repository}@${source.ref}. Run \`leadtype sync\` or pass \`--sync\`/\`--refresh\`.`
      );
    }
    return { source, status: "cached", commit: manifest.commit };
  }

  if (mode === "offline") {
    if (!(hasCheckout && manifestMatches)) {
      throw new Error(
        `--offline: cache miss for collection(s) [${source.collectionKeys.join(", ")}]: ${source.repository}@${source.ref} (cacheDir ${source.cacheDir}).`
      );
    }
    return { source, status: "cached", commit: manifest.commit };
  }

  if (mode === "auto" && hasCheckout && manifestMatches) {
    return { source, status: "cached", commit: manifest.commit };
  }

  const refreshInPlace = mode === "refresh" && hasCheckout && manifestMatches;
  const commit = refreshInPlace
    ? await fastForwardExisting(source, runner)
    : await cloneRemote(source, runner);

  await writeSyncManifest(source.cacheDir, {
    version: 1,
    repository: source.repository,
    ref: source.ref,
    commit,
    syncedAt: new Date().toISOString(),
    ...(source.sparse && source.sparse.length > 0
      ? { sparse: source.sparse }
      : {}),
  });

  // "refreshed" means we fast-forwarded an existing checkout. A destructive
  // re-clone (no prior checkout, or stale ref) is reported as "fresh" so
  // callers can distinguish in-place updates from full re-acquisition.
  const status: SyncStatus = refreshInPlace ? "refreshed" : "fresh";
  return { source, status, commit };
}
