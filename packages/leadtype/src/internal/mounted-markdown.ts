import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { copyFileAtomic, writeFileAtomic } from "./atomic-fs";
import {
  type DocsPathMount,
  normalizeDocsPath,
  normalizeUrlPrefix,
} from "./docs-url";
import { logger } from "./logger";

const DOCS_DIR = "docs";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function fingerprint(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function outputPath(outDir: string, relativePath: string): string {
  const target = path.resolve(outDir, relativePath);
  const relative = path.relative(outDir, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Mounted markdown path "${relativePath}" escapes the output directory.`
    );
  }
  return target;
}

function warnStateFailure(action: "read" | "write", error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.warn({
    human: {
      message: `Could not ${action} mounted Markdown ownership state: ${message}`,
    },
    json: {
      event: `generate.mounted_markdown_state_${action}_failed`,
      fields: { message },
    },
  });
}

async function readOwnedFiles(
  statePath: string,
  outDir: string
): Promise<Map<string, string>> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      return new Map();
    }
    warnStateFailure("read", error);
    return new Map();
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("outDir" in value) ||
    value.outDir !== outDir ||
    !("files" in value) ||
    !Array.isArray(value.files)
  ) {
    return new Map();
  }
  const files = new Map<string, string>();
  for (const entry of value.files) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      typeof entry[1] !== "string" ||
      !SHA256_PATTERN.test(entry[1])
    ) {
      continue;
    }
    const [relativePath, hash] = entry;
    if (
      path.isAbsolute(relativePath) ||
      relativePath.includes("\\") ||
      relativePath
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      !relativePath.endsWith(".md")
    ) {
      continue;
    }
    files.set(relativePath, hash);
  }
  return files;
}

// Never follow a replaced output directory into files the generator does not own.
async function isRegularOutput(
  outDir: string,
  relativePath: string
): Promise<boolean> {
  let current = outDir;
  try {
    for (const part of relativePath.split("/")) {
      current = path.join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        return false;
      }
    }
    return (await lstat(current)).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function removeEmptyParents(
  outDir: string,
  filePath: string
): Promise<void> {
  let current = path.dirname(filePath);
  while (current !== outDir) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/**
 * The caller holds the output directory's generate lock. Ownership records
 * live in a per-user cache so a read-only source tree can still generate.
 * If the cache is cleared, untracked mirrors are preserved rather than guessed.
 */
export async function copyMountedMarkdownMirrors(
  outputDir: string,
  mounts: DocsPathMount[],
  sourceFiles: readonly string[],
  options: { stateDir?: string; prune?: boolean } = {}
): Promise<void> {
  const stateDir =
    options.stateDir ??
    path.join(
      process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"),
      "leadtype",
      "mounted-markdown"
    );
  const outDir = path.resolve(outputDir);
  const statePath = path.join(
    stateDir,
    `mounted-markdown-${fingerprint(outDir)}.json`
  );
  const previous = await readOwnedFiles(statePath, outDir);
  const copies = new Map<string, string>();
  // Only current source pages are canonical. Output globs can include mirrors
  // from earlier runs, even after ownership records have been cleared.
  const canonicalFiles = new Set(
    sourceFiles.map((file) => `${DOCS_DIR}/${normalizeDocsPath(file)}`)
  );

  // Plan every mount before writing or pruning. A root mount must not sweep
  // another mount's output while that mount is still copying its files.
  for (const mount of mounts) {
    const pathPrefix = normalizeDocsPath(mount.pathPrefix);
    const urlPrefix = normalizeUrlPrefix(mount.urlPrefix);
    if (urlPrefix === (pathPrefix ? `/docs/${pathPrefix}` : "/docs")) {
      continue;
    }
    const sourceDir = path.join(outDir, DOCS_DIR, pathPrefix);
    if (!existsSync(sourceDir)) {
      continue;
    }
    const targetDir = path.join(outDir, urlPrefix.slice(1));
    for (const canonicalPath of canonicalFiles) {
      const source = outputPath(outDir, canonicalPath);
      const file = path.relative(sourceDir, source);
      if (
        !file ||
        file.startsWith("..") ||
        path.isAbsolute(file) ||
        !existsSync(source)
      ) {
        continue;
      }
      const target = path.join(targetDir, file);
      const relativePath = normalizeDocsPath(path.relative(outDir, target));
      outputPath(outDir, relativePath);
      if (canonicalFiles.has(relativePath) && source !== target) {
        throw new Error(
          `Mounted markdown "${relativePath}" would overwrite primary docs.`
        );
      }
      const existing = copies.get(relativePath);
      if (existing && existing !== source) {
        throw new Error(
          `Multiple mounted markdown sources write "${relativePath}".`
        );
      }
      copies.set(relativePath, source);
    }
  }

  // A filtered run does not own the excluded pages. Keep their records so a
  // later full run can still prune them if the sources really disappear.
  const current = new Map<string, string>(
    options.prune === false ? previous : undefined
  );
  for (const [relativePath, source] of copies) {
    const target = outputPath(outDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFileAtomic(source, target);
    current.set(relativePath, fingerprint(await readFile(target)));
  }
  for (const [relativePath, hash] of previous) {
    if (
      current.has(relativePath) ||
      canonicalFiles.has(relativePath) ||
      !(await isRegularOutput(outDir, relativePath))
    ) {
      continue;
    }
    const target = outputPath(outDir, relativePath);
    if (fingerprint(await readFile(target)) !== hash) {
      continue;
    }
    await rm(target, { force: true });
    await removeEmptyParents(outDir, target);
  }
  if (current.size === 0 && previous.size === 0) {
    return;
  }
  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(
      statePath,
      `${JSON.stringify({ version: 1, outDir, files: [...current] })}\n`
    );
  } catch (error) {
    warnStateFailure("write", error);
  }
}
