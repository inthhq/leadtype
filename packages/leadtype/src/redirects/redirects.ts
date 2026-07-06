/**
 * Redirect computation for renamed and deleted docs pages (issue #98).
 *
 * A committed lockfile records every page's public path and a content hash.
 * On the next generate, a path that disappeared while its hash reappeared at
 * a new path is a pure move and gets an automatic permanent redirect. A path
 * that disappeared with no successor fails the build loudly — the author
 * either adds `redirectFrom` frontmatter to the successor page or lists the
 * path under `redirects.removed` in the docs config to serve 410 Gone.
 *
 * This module is runtime-agnostic (no filesystem access) so `resolveRedirect`
 * can run inside edge/server handlers. Lockfile and artifact IO lives in
 * `./node`.
 */

export const REDIRECT_STATUS_MOVED = 308;
export const REDIRECT_STATUS_GONE = 410;

export type DocsRedirect = {
  /** Root-relative public path that no longer serves content, e.g. `/docs/guides/x`. */
  from: string;
  /** Redirect target. Absent for 410 Gone entries. */
  to?: string;
  /** HTTP status: 308 for moves, 410 for acknowledged removals. */
  status: number;
};

export type DocsPathsLockfilePage = {
  /** Public URL path of the page, e.g. `/docs/guides/script-loader`. */
  path: string;
  /** Content hash of the page body (frontmatter excluded). */
  hash: string;
};

export type DocsPathsLockfile = {
  version: 1;
  /** Every live page at the time of the last generate, sorted by path. */
  pages: DocsPathsLockfilePage[];
  /** Accumulated redirects from prior renames/removals, sorted by `from`. */
  redirects: DocsRedirect[];
};

export type RedirectPageInput = {
  urlPath: string;
  /** Content hash of the page body (use `hashRedirectContent`). */
  hash: string;
  /** Old paths this page explicitly claims, from `redirectFrom` frontmatter. */
  redirectFrom?: string[];
};

export type ComputeDocsRedirectsInput = {
  /** Lockfile from the previous generate; undefined on first run. */
  previous?: DocsPathsLockfile;
  /** Every live page in this generate. */
  pages: RedirectPageInput[];
  /** Paths acknowledged as intentionally deleted → 410 Gone. */
  removed?: string[];
};

export type ComputeDocsRedirectsResult = {
  /** Next lockfile state to persist. */
  lockfile: DocsPathsLockfile;
  /** Full redirect set to serve (moves, removals, carried-forward entries). */
  redirects: DocsRedirect[];
  /** Renames auto-detected this run via content-hash match. */
  moved: { from: string; to: string }[];
  /**
   * Paths that disappeared with no hash match, no `redirectFrom` claim, and
   * no `removed` acknowledgment. Callers must fail loudly on these — a
   * silently dropped path is a dead URL in every index that ever linked it.
   */
  unmatched: string[];
};

const TRAILING_SLASHES_PATTERN = /\/+$/;

export function normalizeRedirectPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailing = withLeadingSlash.replace(
    TRAILING_SLASHES_PATTERN,
    ""
  );
  return withoutTrailing === "" ? "/" : withoutTrailing;
}

/**
 * Resolve chains left by successive renames (A→B committed, then B→C) to
 * their final target, so consumers never issue multi-hop redirects. Returns
 * undefined when the chain loops.
 */
function resolveChain(
  start: string,
  targets: Map<string, string>
): string | undefined {
  let current = start;
  const seen = new Set<string>();
  while (targets.has(current)) {
    if (seen.has(current)) {
      return;
    }
    seen.add(current);
    current = targets.get(current) as string;
  }
  return current;
}

function detectMoves(
  previous: DocsPathsLockfile | undefined,
  pages: RedirectPageInput[]
): { moved: { from: string; to: string }[]; disappeared: string[] } {
  const previousPages = previous?.pages ?? [];
  const currentPaths = new Set(pages.map((page) => page.urlPath));
  const previousPaths = new Set(previousPages.map((page) => page.path));

  const disappeared = previousPages.filter(
    (page) => !currentPaths.has(page.path)
  );
  const appeared = pages.filter((page) => !previousPaths.has(page.urlPath));

  // A move is only unambiguous when the hash identifies exactly one
  // disappeared page and exactly one appeared page. Duplicate hashes on
  // either side (shared boilerplate pages) fall through to `unmatched`
  // rather than guessing.
  const appearedByHash = new Map<string, string[]>();
  for (const page of appeared) {
    const paths = appearedByHash.get(page.hash) ?? [];
    paths.push(page.urlPath);
    appearedByHash.set(page.hash, paths);
  }
  const disappearedHashCounts = new Map<string, number>();
  for (const page of disappeared) {
    disappearedHashCounts.set(
      page.hash,
      (disappearedHashCounts.get(page.hash) ?? 0) + 1
    );
  }

  const moved: { from: string; to: string }[] = [];
  const stillDisappeared: string[] = [];
  for (const page of disappeared) {
    const candidates = appearedByHash.get(page.hash) ?? [];
    const isUnambiguous =
      candidates.length === 1 && disappearedHashCounts.get(page.hash) === 1;
    const target = candidates[0];
    if (isUnambiguous && target !== undefined) {
      moved.push({ from: page.path, to: target });
    } else {
      stillDisappeared.push(page.path);
    }
  }
  return { moved, disappeared: stillDisappeared };
}

export function computeDocsRedirects(
  input: ComputeDocsRedirectsInput
): ComputeDocsRedirectsResult {
  const pages = input.pages.map((page) => ({
    ...page,
    urlPath: normalizeRedirectPath(page.urlPath),
  }));
  const currentPaths = new Set(pages.map((page) => page.urlPath));
  const removed = (input.removed ?? []).map(normalizeRedirectPath);

  const { moved, disappeared } = detectMoves(input.previous, pages);

  // from → to for everything that redirects after this run; used both to
  // collapse chains in carried-forward entries and to dedupe.
  const targetByFrom = new Map<string, string>();
  for (const move of moved) {
    targetByFrom.set(move.from, move.to);
  }
  for (const page of pages) {
    for (const rawFrom of page.redirectFrom ?? []) {
      const from = normalizeRedirectPath(rawFrom);
      if (currentPaths.has(from)) {
        throw new Error(
          `redirectFrom path "${from}" (claimed by ${page.urlPath}) is still a live page — remove the entry or the page.`
        );
      }
      targetByFrom.set(from, page.urlPath);
    }
  }

  const redirects = new Map<string, DocsRedirect>();
  const gone = new Set<string>();
  for (const from of removed) {
    if (!(currentPaths.has(from) || targetByFrom.has(from))) {
      gone.add(from);
      redirects.set(from, { from, status: REDIRECT_STATUS_GONE });
    }
  }
  for (const [from, to] of targetByFrom) {
    redirects.set(from, { from, to, status: REDIRECT_STATUS_MOVED });
  }

  // Carry forward history so a path renamed two generates ago keeps
  // redirecting. Entries whose `from` is live again (page recreated) drop;
  // entries whose target has since moved collapse to the final target;
  // entries whose target was removed become 410.
  for (const entry of input.previous?.redirects ?? []) {
    const from = normalizeRedirectPath(entry.from);
    if (currentPaths.has(from) || redirects.has(from)) {
      continue;
    }
    if (entry.to === undefined) {
      redirects.set(from, { from, status: REDIRECT_STATUS_GONE });
      continue;
    }
    const target = resolveChain(normalizeRedirectPath(entry.to), targetByFrom);
    if (target === undefined || gone.has(target)) {
      redirects.set(from, { from, status: REDIRECT_STATUS_GONE });
    } else {
      redirects.set(from, {
        from,
        to: target,
        status: REDIRECT_STATUS_MOVED,
      });
    }
  }

  const covered = (path: string): boolean =>
    redirects.has(path) || gone.has(path);
  const unmatched = disappeared.filter((path) => !covered(path));

  const sortedRedirects = [...redirects.values()].sort((left, right) =>
    left.from.localeCompare(right.from)
  );
  const lockfile: DocsPathsLockfile = {
    version: 1,
    pages: pages
      .map((page) => ({ path: page.urlPath, hash: page.hash }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    redirects: sortedRedirects,
  };

  return { lockfile, redirects: sortedRedirects, moved, unmatched };
}

const MARKDOWN_EXTENSION_PATTERN = /\.md$/;

/**
 * Mirror path for a redirect target on the `.md` surface. Leaf routes map
 * `path` → `path.md`; the root route's mirror lives at `/index.md`. Targets
 * at nested index routes may use an `index.md` mirror too — handlers with a
 * manifest should prefer the target page's recorded `markdownUrlPath`
 * (`createAgentMarkdownResponse` does).
 */
function toMarkdownMirrorPath(urlPath: string): string {
  return urlPath === "/" ? "/index.md" : `${urlPath}.md`;
}

/**
 * Look up the redirect for a request path. Handles the `.md` mirror surface:
 * `/docs/old.md` follows `/docs/old` → `/docs/new` and lands on
 * `/docs/new.md`, so agents holding stale mirror URLs are redirected too.
 */
export function resolveRedirect(
  requestPath: string,
  redirects: DocsRedirect[]
): DocsRedirect | undefined {
  const normalized = normalizeRedirectPath(requestPath);
  const direct = redirects.find((entry) => entry.from === normalized);
  if (direct) {
    return direct;
  }
  if (!MARKDOWN_EXTENSION_PATTERN.test(normalized)) {
    return;
  }
  const base = normalized.replace(MARKDOWN_EXTENSION_PATTERN, "");
  const viaBase = redirects.find((entry) => entry.from === base);
  if (!viaBase) {
    return;
  }
  return viaBase.to === undefined
    ? { from: normalized, status: viaBase.status }
    : {
        from: normalized,
        to: toMarkdownMirrorPath(viaBase.to),
        status: viaBase.status,
      };
}
