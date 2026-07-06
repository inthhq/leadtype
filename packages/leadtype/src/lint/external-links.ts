import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";

/**
 * External-link checking (`external-link` rule). Deliberately opt-in and
 * built for scheduled CI, not PR CI: network checks are inherently flaky and
 * must never sit in a merge gate. Results for live URLs are cached with a
 * TTL so warm runs over a large corpus stay fast; failures are never cached,
 * so a site that comes back is noticed on the next run.
 */

export type ExternalLink = {
  /** Page file (docs-relative POSIX path). */
  file: string;
  /** File-relative line of the link, when known. */
  line?: number;
  url: string;
};

export type ExternalLinkIssue = {
  rule: "external-link";
  file: string;
  line?: number;
  url: string;
  message: string;
};

const HTTP_URL_PATTERN = /^https?:\/\//i;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 8;
const RETRY_DELAY_MS = 500;
const USER_AGENT =
  "leadtype-lint/1.0 (+https://leadtype.dev/docs/pipeline/validate-in-ci)";
const CACHE_VERSION = 1;

/** Collect absolute http(s) links (inline, reference, image) with positions. */
export function collectExternalLinks(
  tree: Root | null,
  file: string,
  lineOffset = 0
): ExternalLink[] {
  if (!tree) {
    return [];
  }
  const links: ExternalLink[] = [];
  visit(tree, ["link", "definition", "image"], (node) => {
    const candidate = node as {
      url?: unknown;
      position?: { start?: { line?: number } };
    };
    const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
    if (!HTTP_URL_PATTERN.test(url)) {
      return;
    }
    const line = candidate.position?.start?.line;
    links.push({
      file,
      line: line === undefined ? undefined : line + lineOffset,
      url,
    });
  });
  return links;
}

type CacheEntry = {
  status: number;
  checkedAt: number;
};

type CacheFile = {
  version: typeof CACHE_VERSION;
  entries: Record<string, CacheEntry>;
};

async function loadCache(cacheFile: string | undefined): Promise<CacheFile> {
  const empty: CacheFile = { version: CACHE_VERSION, entries: {} };
  if (!cacheFile) {
    return empty;
  }
  try {
    const parsed = JSON.parse(await readFile(cacheFile, "utf8")) as CacheFile;
    if (
      parsed.version === CACHE_VERSION &&
      typeof parsed.entries === "object" &&
      parsed.entries !== null
    ) {
      return parsed;
    }
  } catch {
    // Missing/corrupt cache degrades to a cold run.
  }
  return empty;
}

async function saveCache(
  cacheFile: string | undefined,
  cache: CacheFile
): Promise<void> {
  if (!cacheFile) {
    return;
  }
  try {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(cache));
  } catch {
    // A cache we can't write just means a cold run next time.
  }
}

export type CheckExternalLinksOptions = {
  links: ExternalLink[];
  /** Cache location, e.g. node_modules/.cache/leadtype/external-links.json. */
  cacheFile?: string;
  /** How long a confirmed-live URL stays trusted. Default 7 days. */
  ttlMs?: number;
  /** Per-request timeout. Default 10s. */
  timeoutMs?: number;
  /** Concurrent requests. Default 8. */
  concurrency?: number;
  /** URL prefixes to skip (known-flaky hosts, auth-walled URLs). */
  ignore?: string[];
  /** Injectable for tests; defaults to global fetch. */
  fetcher?: typeof fetch;
  /** Current time, injectable for TTL tests. */
  now?: () => number;
};

type UrlVerdict =
  | { kind: "alive"; status: number }
  | { kind: "dead"; detail: string }
  | { kind: "skipped" };

async function requestOnce(
  fetcher: typeof fetch,
  url: string,
  method: "HEAD" | "GET",
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function probe(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<UrlVerdict> {
  let response: Response;
  try {
    response = await requestOnce(fetcher, url, "HEAD", timeoutMs);
    // Servers that reject HEAD aren't dead — retry the real method.
    if ([403, 405, 501].includes(response.status)) {
      response = await requestOnce(fetcher, url, "GET", timeoutMs);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { kind: "dead", detail: `timed out after ${timeoutMs}ms` };
    }
    return {
      kind: "dead",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (response.status === 429) {
    // Rate limited is not dead; don't fail and don't cache.
    return { kind: "skipped" };
  }
  if (response.ok || (response.status >= 300 && response.status < 400)) {
    return { kind: "alive", status: response.status };
  }
  return { kind: "dead", detail: `HTTP ${response.status}` };
}

async function verdictWithRetry(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<UrlVerdict> {
  const first = await probe(fetcher, url, timeoutMs);
  if (first.kind !== "dead") {
    return first;
  }
  // One retry after a short pause: transient network blips and 5xx hiccups
  // shouldn't fail a scheduled run.
  await new Promise((resolvePause) => setTimeout(resolvePause, RETRY_DELAY_MS));
  return await probe(fetcher, url, timeoutMs);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) {
          return;
        }
        const item = items[index];
        if (item === undefined) {
          return;
        }
        results[index] = await fn(item);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/**
 * Check every external link, deduped by URL, with cache + retry + HEAD→GET
 * fallback. Returns one issue per link occurrence whose URL is dead.
 */
export async function checkExternalLinks(
  options: CheckExternalLinksOptions
): Promise<ExternalLinkIssue[]> {
  const fetcher = options.fetcher ?? fetch;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const ignore = options.ignore ?? [];

  const candidates = options.links.filter(
    (link) => !ignore.some((prefix) => link.url.startsWith(prefix))
  );
  const cache = await loadCache(options.cacheFile);
  const uniqueUrls = [...new Set(candidates.map((link) => link.url))].filter(
    (url) => {
      const entry = cache.entries[url];
      return !entry || now() - entry.checkedAt > ttlMs;
    }
  );

  const verdicts = new Map<string, UrlVerdict>();
  const checked = await mapWithConcurrency(
    uniqueUrls,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (url) => ({
      url,
      verdict: await verdictWithRetry(fetcher, url, timeoutMs),
    })
  );
  for (const { url, verdict } of checked) {
    verdicts.set(url, verdict);
    if (verdict.kind === "alive") {
      cache.entries[url] = { status: verdict.status, checkedAt: now() };
    }
  }
  await saveCache(options.cacheFile, cache);

  const issues: ExternalLinkIssue[] = [];
  for (const link of candidates) {
    const verdict = verdicts.get(link.url);
    if (verdict?.kind !== "dead") {
      continue; // alive, skipped, or served from cache
    }
    issues.push({
      rule: "external-link",
      file: link.file,
      line: link.line,
      url: link.url,
      message: `external link \`${link.url}\` appears dead: ${verdict.detail}`,
    });
  }
  return issues;
}
