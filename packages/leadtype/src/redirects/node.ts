import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../internal/atomic-fs";
import { parseFrontmatter } from "../internal/frontmatter";
import {
  type ComputeDocsRedirectsResult,
  computeDocsRedirects,
  type DocsPathsLockfile,
  type RedirectPageInput,
} from "./redirects";

const HASH_LENGTH = 16;
const SOURCE_EXTENSIONS = [".mdx", ".md"] as const;

/**
 * Hash a page's body for rename detection. Frontmatter is excluded so
 * enrichment-only churn (git `lastModified`, synthesized fields) doesn't
 * defeat the pure-move match; whitespace at the edges is ignored for the
 * same reason.
 */
export function hashRedirectContent(markdown: string): string {
  const { content } = parseFrontmatter(markdown);
  return createHash("sha256")
    .update(content.trim())
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

export type RedirectPageFile = {
  relativePath: string;
  sourcePath?: string;
  /**
   * Path without locale prefix or extension, from the readability manifest.
   * Needed when the default locale is authored under `docs/<locale>/` — the
   * output `relativePath` strips that segment.
   */
  logicalPath?: string;
  /**
   * Locale of the file on disk. For `includeFallback` pages this is the
   * default locale, not the requested one, so the probe can find the
   * authored file instead of looking under a locale folder that does not
   * exist.
   */
  sourceLocale?: string;
};

function isSafeRelative(relative: string): boolean {
  return relative.length > 0 && !relative.split("/").includes("..");
}

function firstExistingSource(
  sourceDir: string,
  relative: string
): string | undefined {
  if (!isSafeRelative(relative)) {
    return;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = path.join(
      sourceDir,
      ...`${relative}${extension}`.split("/")
    );
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return;
}

function generatedMirrorPath(outDir: string, relativePath: string): string {
  return path.join(outDir, "docs", ...`${relativePath}.md`.split("/"));
}

/**
 * Prefer the authored source (`.mdx` then `.md`) over the generated `.md`
 * mirror. Generated output embeds ExtractedTypeTable rows, expanded includes,
 * and converter formatting — hashing it rewrites the committed lockfile on
 * unrelated type or pipeline changes.
 *
 * Lookup order when `sourceDir` is set:
 * 1. `page.sourcePath` if provided
 * 2. `<sourceDir>/<sourceLocale>/<logicalPath>.{mdx,md}` (i18n on-disk locale)
 * 3. `<sourceDir>/<logicalPath>.{mdx,md}` (default locale at the docs root)
 * 4. `<sourceDir>/<relativePath>.{mdx,md}` (output path, non-i18n and
 *    non-default locales whose folder is already in `relativePath`)
 * 5. the generated mirror
 */
export function resolveRedirectPageFile(
  page: RedirectPageFile,
  options: { outDir: string; sourceDir?: string }
): string {
  if (page.sourcePath) {
    return page.sourcePath;
  }
  if (options.sourceDir) {
    if (page.logicalPath) {
      if (page.sourceLocale) {
        const nested = firstExistingSource(
          options.sourceDir,
          `${page.sourceLocale}/${page.logicalPath}`
        );
        if (nested) {
          return nested;
        }
      }
      const atRoot = firstExistingSource(options.sourceDir, page.logicalPath);
      if (atRoot) {
        return atRoot;
      }
    }
    const byOutput = firstExistingSource(options.sourceDir, page.relativePath);
    if (byOutput) {
      return byOutput;
    }
  }
  return generatedMirrorPath(options.outDir, page.relativePath);
}

export async function readPathsLockfile(
  filePath: string
): Promise<DocsPathsLockfile | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `paths lockfile at "${filePath}" is not valid JSON — fix or delete it and rerun generate.`
    );
  }
  const lockfile = parsed as Partial<DocsPathsLockfile>;
  if (
    lockfile.version !== 1 ||
    !Array.isArray(lockfile.pages) ||
    !Array.isArray(lockfile.redirects)
  ) {
    throw new Error(
      `paths lockfile at "${filePath}" has an unsupported shape — expected { version: 1, pages, redirects }.`
    );
  }
  return lockfile as DocsPathsLockfile;
}

function normalizeRedirectFrom(raw: unknown): string[] {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

export type UpdateDocsRedirectsConfig = {
  /** Committed lockfile location, e.g. `<docs source dir>/paths.lock.json`. */
  lockfilePath: string;
  /** Generate output root; `docs/redirects.json` is written beneath it. */
  outDir: string;
  /**
   * Authored docs root (convert input). When set, each page is hashed from
   * its source `.mdx`/`.md` rather than the generated mirror, so type-table,
   * include, and converter churn cannot dirty the committed lockfile.
   */
  sourceDir?: string;
  /**
   * Live pages from the readability manifest. `relativePath` locates the
   * emitted mirror (`<outDir>/docs/<relativePath>.md`). Authored source is
   * resolved via `logicalPath` + `sourceLocale` when present, then
   * `relativePath`. The manifest's `markdownUrlPath` is the *served* URL,
   * which diverges from the file location for index routes
   * (`/docs/rest-api.md` vs `rest-api/index.md`).
   */
  pages: (RedirectPageFile & { urlPath: string })[];
  /** Paths acknowledged as intentionally deleted → 410 Gone. */
  removed?: string[];
};

export type UpdateDocsRedirectsResult = ComputeDocsRedirectsResult & {
  lockfilePath: string;
  redirectsPath: string;
};

/**
 * Generate-time redirect step: read the committed lockfile, hash every live
 * page, detect renames, fail loudly on unexplained disappearances, then
 * persist the next lockfile and emit `<outDir>/docs/redirects.json`.
 */
export async function updateDocsRedirects(
  config: UpdateDocsRedirectsConfig
): Promise<UpdateDocsRedirectsResult> {
  const previous = await readPathsLockfile(config.lockfilePath);

  const pages: RedirectPageInput[] = await Promise.all(
    config.pages.map(async (page) => {
      const hashFile = resolveRedirectPageFile(page, {
        outDir: config.outDir,
        ...(config.sourceDir === undefined
          ? {}
          : { sourceDir: config.sourceDir }),
      });
      const hashMarkdown = await readFile(hashFile, "utf8");
      // redirectFrom is read from the generated mirror so afterFrontmatter
      // transformers that synthesize it still apply. The hash stays on the
      // authored source (or the mirror, when no source was found).
      const mirrorFile = generatedMirrorPath(config.outDir, page.relativePath);
      const redirectMarkdown =
        path.resolve(hashFile) === path.resolve(mirrorFile)
          ? hashMarkdown
          : await readFile(mirrorFile, "utf8");
      const { data } = parseFrontmatter(redirectMarkdown);
      const redirectFrom = normalizeRedirectFrom(data.redirectFrom);
      return {
        urlPath: page.urlPath,
        hash: hashRedirectContent(hashMarkdown),
        ...(redirectFrom.length > 0 ? { redirectFrom } : {}),
      };
    })
  );

  const result = computeDocsRedirects({
    pages,
    ...(previous ? { previous } : {}),
    removed: config.removed ?? [],
  });

  if (result.unmatched.length > 0) {
    const list = result.unmatched.map((entry) => `  - ${entry}`).join("\n");
    throw new Error(
      `${result.unmatched.length} docs page(s) disappeared without a redirect:\n${list}\n` +
        "Old URLs would 404 in search engines and agent indexes. Either add " +
        "`redirectFrom: [<old path>]` frontmatter to each page's successor, or " +
        "acknowledge intentional deletions under `redirects.removed` in the docs " +
        "config to serve 410 Gone."
    );
  }

  const redirectsPath = path.join(config.outDir, "docs", "redirects.json");
  const lockfileJson = `${JSON.stringify(result.lockfile, null, 2)}\n`;
  const previousJson = previous
    ? `${JSON.stringify(previous, null, 2)}\n`
    : undefined;
  if (lockfileJson !== previousJson) {
    await writeFileAtomic(config.lockfilePath, lockfileJson);
  }
  await writeFileAtomic(
    redirectsPath,
    `${JSON.stringify({ version: 1, redirects: result.redirects }, null, 2)}\n`
  );

  return { ...result, lockfilePath: config.lockfilePath, redirectsPath };
}
