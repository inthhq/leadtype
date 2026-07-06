import { createHash } from "node:crypto";
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
   * Live pages from the readability manifest. `relativePath` locates the
   * emitted mirror file (`<outDir>/docs/<relativePath>.md`) — the manifest's
   * `markdownUrlPath` is the *served* URL, which diverges from the file
   * location for index routes (`/docs/rest-api.md` vs `rest-api/index.md`).
   */
  pages: { urlPath: string; relativePath: string }[];
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
      const mirrorPath = path.join(
        config.outDir,
        "docs",
        ...`${page.relativePath}.md`.split("/")
      );
      const markdown = await readFile(mirrorPath, "utf8");
      const { data } = parseFrontmatter(markdown);
      const redirectFrom = normalizeRedirectFrom(data.redirectFrom);
      return {
        urlPath: page.urlPath,
        hash: hashRedirectContent(markdown),
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
