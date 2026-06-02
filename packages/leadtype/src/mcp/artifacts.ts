import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  createPublicMarkdownReader,
  isMissingFileError,
  type ReadMarkdownFile,
} from "../internal/framework.js";
import {
  type AgentReadabilityManifest,
  normalizeAgentReadabilityManifest,
} from "../llm/readability.js";
import type {
  DocsSearchContentStore,
  DocsSearchIndex,
} from "../search/index.js";

/**
 * Subdirectory (under the artifacts base) that `generate` writes docs artifacts
 * into — both for site mode (`<public>/docs`) and bundle mode (`<package>/docs`).
 */
const DOCS_SUBDIR = "docs";
const SEARCH_INDEX_FILE = "search-index.json";
const SEARCH_CONTENT_FILE = "search-content.json";
const MANIFEST_FILE = "agent-readability.json";
const MAX_PACKAGE_ROOT_DEPTH = 10;

/**
 * The generated artifacts a docs MCP server reads at runtime. The search index
 * is the ranking backend; `readMarkdown` reads the `.md` mirror from disk so
 * `get-page` returns byte-identical content to the content-negotiation handler
 * (DESIGN.md Q2 — the `.md` mirror is the single content surface).
 */
export type DocsArtifacts = {
  index: DocsSearchIndex;
  /** Present when `search-content.json` was emitted separately (improves excerpts). */
  content?: DocsSearchContentStore;
  manifest: AgentReadabilityManifest;
  readMarkdown: ReadMarkdownFile;
  /** Resolved base directory the artifacts were loaded from. */
  baseDir: string;
};

export type LoadDocsArtifactsOptions = {
  /**
   * Base directory containing a `docs/` folder — a site `public` dir (site mode)
   * or an installed package root (bundle mode). Defaults to `./public`.
   */
  artifacts?: string;
};

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function missingArtifactError(baseDir: string, file: string): Error {
  const docsDir = path.join(baseDir, DOCS_SUBDIR);
  return new Error(
    `leadtype: no generated docs at ${docsDir} (missing ${file}). Either:\n` +
      "  • run `leadtype generate` so it writes ./public/docs, then retry; or\n" +
      "  • point `--artifacts <dir>` at a directory that contains a generated `docs/` folder; or\n" +
      "  • pass `--package <name>` to read an installed package's bundled docs from node_modules."
  );
}

/**
 * Loads the generated docs artifacts needed to run an MCP server. Works for both
 * site artifacts (`./public/docs`) and bundled artifacts (`<package>/docs`) — the
 * caller resolves which base directory to pass (see `resolveBundleArtifactsBase`).
 */
export async function loadDocsArtifacts(
  options: LoadDocsArtifactsOptions = {}
): Promise<DocsArtifacts> {
  const baseDir = path.resolve(options.artifacts ?? "./public");
  const docsDir = path.join(baseDir, DOCS_SUBDIR);

  const index = await readOptionalJson<DocsSearchIndex>(
    path.join(docsDir, SEARCH_INDEX_FILE)
  );
  if (!index) {
    throw missingArtifactError(baseDir, SEARCH_INDEX_FILE);
  }

  const rawManifest = await readOptionalJson<unknown>(
    path.join(docsDir, MANIFEST_FILE)
  );
  if (!rawManifest) {
    throw missingArtifactError(baseDir, MANIFEST_FILE);
  }

  const content =
    (await readOptionalJson<DocsSearchContentStore>(
      path.join(docsDir, SEARCH_CONTENT_FILE)
    )) ?? undefined;

  return {
    index,
    content,
    manifest: normalizeAgentReadabilityManifest(rawManifest),
    // The markdown mirror lives at `<baseDir>/docs/**.md`; the reader resolves a
    // MarkdownMirrorTarget's `filePath` (e.g. `docs/quickstart.md`) under baseDir.
    readMarkdown: createPublicMarkdownReader(baseDir),
    baseDir,
  };
}

/**
 * Resolves the directory that holds an installed package's bundled docs artifacts
 * (bundle mode). Returns the package root, which contains the `docs/` folder the
 * package shipped. Throws a helpful error if the package can't be resolved.
 */
export function resolveBundleArtifactsBase(
  packageName: string,
  fromDir: string = process.cwd()
): string {
  // createRequire throws ERR_INVALID_ARG_VALUE on a relative path (e.g. `.`),
  // so anchor it to an absolute package.json location.
  const require = createRequire(path.resolve(fromDir, "package.json"));
  // Preferred: the package exposes `./package.json` in its exports map.
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    // Fall through.
  }
  // Fallback for packages whose `exports` map blocks `./package.json`: resolve
  // the entry and walk up to the nearest package root.
  try {
    let dir = path.dirname(require.resolve(packageName));
    for (let depth = 0; depth < MAX_PACKAGE_ROOT_DEPTH; depth++) {
      if (existsSync(path.join(dir, "package.json"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  } catch {
    // Fall through.
  }
  throw new Error(
    `leadtype mcp: could not resolve package "${packageName}" from ${fromDir}. ` +
      "Install it, or pass --artifacts <dir> pointing at a directory with a `docs/` folder."
  );
}
