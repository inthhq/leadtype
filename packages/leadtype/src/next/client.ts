"use client";

/**
 * `leadtype/next/client` — React hooks for client components.
 *
 * Lazy-loads the static `search-index.json` and `search-content.json`
 * artifacts emitted by `leadtype generate`, then runs `searchDocs()` per
 * keystroke. Edge-safe: only uses `fetch` and pure functions from
 * `leadtype/search`.
 *
 * ```tsx title="components/docs-search.tsx"
 * "use client";
 * import { useLeadtypeSearch } from "leadtype/next/client";
 *
 * export function DocsSearch() {
 *   const { query, search, results, status } = useLeadtypeSearch("docs");
 *   return (
 *     <>
 *       <input value={query} onChange={(e) => search(e.target.value)} />
 *       {status === "loading" ? "Loading…" : null}
 *       <ul>{results.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
 *     </>
 *   );
 * }
 * ```
 *
 * The vanilla `createSearchClient` factory is exported for non-React usage
 * (worker, web component, plain script) and keeps the BM25 path
 * unit-testable without React.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DocsSearchContentStore,
  DocsSearchIndex,
  DocsSearchResult,
} from "../search/search";
import { searchDocs } from "../search/search";

export type { DocsSearchResult } from "../search/search";

export type SearchClientOptions = {
  /** Override the index URL. Default: `/${collection}/search-index.json`. */
  indexUrl?: string;
  /** Override the content URL. Default: `/${collection}/search-content.json`. */
  contentUrl?: string;
  /** Max results returned per query. */
  limit?: number;
  /** Inject a fetch impl (Edge / SSR / tests). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
};

export type SearchClient = {
  /** Run a query. Loads artifacts on first call, caches them after. */
  search(query: string): Promise<DocsSearchResult[]>;
  /** Force-prefetch the artifacts. Optional; `search()` loads them lazily. */
  preload(): Promise<void>;
};

type LoadedArtifacts = {
  index: DocsSearchIndex;
  content: DocsSearchContentStore | undefined;
};

const artifactCache = new Map<string, Promise<LoadedArtifacts>>();

function cacheKey(indexUrl: string, contentUrl: string): string {
  return `${indexUrl}|${contentUrl}`;
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `leadtype/next/client: failed to fetch ${url} (${response.status} ${response.statusText})`
    );
  }
  return (await response.json()) as T;
}

async function loadArtifacts(
  indexUrl: string,
  contentUrl: string,
  fetchImpl: typeof fetch
): Promise<LoadedArtifacts> {
  const key = cacheKey(indexUrl, contentUrl);
  const cached = artifactCache.get(key);
  if (cached) {
    return await cached;
  }
  const promise = (async () => {
    const [index, content] = await Promise.all([
      fetchJson<DocsSearchIndex>(indexUrl, fetchImpl),
      // The content file is optional — the BM25 index runs without it, only
      // excerpts go missing. Treat a 404 as "no content store" rather than
      // failing the whole search.
      fetchJson<DocsSearchContentStore>(contentUrl, fetchImpl).catch(
        () => undefined
      ),
    ]);
    return { index, content };
  })();
  artifactCache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    artifactCache.delete(key);
    throw error;
  }
}

/**
 * Build a framework-free search client. Use directly from a worker, plain
 * script, or web component. Reused by `useLeadtypeSearch` so the BM25 path
 * has a single implementation.
 */
export function createSearchClient(
  collection: string,
  options: SearchClientOptions = {}
): SearchClient {
  const indexUrl = options.indexUrl ?? `/${collection}/search-index.json`;
  const contentUrl = options.contentUrl ?? `/${collection}/search-content.json`;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      "leadtype/next/client: no fetch implementation available. Pass `options.fetch` when running in an environment without globalThis.fetch."
    );
  }
  return {
    async search(query) {
      const trimmed = query.trim();
      if (trimmed.length === 0) {
        return [];
      }
      const { index, content } = await loadArtifacts(
        indexUrl,
        contentUrl,
        fetchImpl
      );
      return searchDocs(index, trimmed, {
        limit: options.limit,
        content,
      });
    },
    async preload() {
      await loadArtifacts(indexUrl, contentUrl, fetchImpl);
    },
  };
}

export type UseLeadtypeSearchOptions = SearchClientOptions & {
  /** Debounce in ms applied between `search()` and the BM25 run. Default 120. */
  debounceMs?: number;
};

export type UseLeadtypeSearchReturn = {
  /** Current query string (mirrors what `search()` was last called with). */
  query: string;
  /** Update the query. Debounced; cancels any in-flight result for stale calls. */
  search(query: string): void;
  /** Latest result list. Empty when the query is empty. */
  results: DocsSearchResult[];
  /** Lifecycle: `idle` before first call, then `loading` → `ready` or `error`. */
  status: "idle" | "loading" | "ready" | "error";
  /** Most recent error, if any. */
  error: Error | null;
};

const DEFAULT_DEBOUNCE_MS = 120;

/**
 * React hook returning a debounced search state object.
 *
 * Lazy-loads the search artifacts on first non-empty query and caches them in
 * a module-level map so route changes and remounts don't refetch. Pass
 * `options.indexUrl` / `options.contentUrl` to override the default URLs.
 */
export function useLeadtypeSearch(
  collection: string,
  options: UseLeadtypeSearchOptions = {}
): UseLeadtypeSearchReturn {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocsSearchResult[]>([]);
  const [status, setStatus] =
    useState<UseLeadtypeSearchReturn["status"]>("idle");
  const [error, setError] = useState<Error | null>(null);

  // Stash the client in a ref so re-renders don't rebuild it. Recompute when
  // the URLs change so consumers can swap collections at runtime if needed.
  const clientRef = useRef<SearchClient | null>(null);
  const indexUrl = options.indexUrl ?? `/${collection}/search-index.json`;
  const contentUrl = options.contentUrl ?? `/${collection}/search-content.json`;
  const fetchImpl = options.fetch;
  const limit = options.limit;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  useEffect(() => {
    clientRef.current = createSearchClient(collection, {
      indexUrl,
      contentUrl,
      fetch: fetchImpl,
      limit,
    });
  }, [collection, indexUrl, contentUrl, fetchImpl, limit]);

  // Track the most recent query so debounced callbacks for stale queries
  // discard their results instead of overwriting the latest state.
  const latestQueryRef = useRef("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    },
    []
  );

  const search = useCallback(
    (next: string) => {
      setQuery(next);
      latestQueryRef.current = next;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      const trimmed = next.trim();
      if (trimmed.length === 0) {
        setResults([]);
        setStatus("idle");
        setError(null);
        return;
      }
      setStatus("loading");
      timeoutRef.current = setTimeout(() => {
        const client = clientRef.current;
        if (!client) {
          return;
        }
        client
          .search(trimmed)
          .then((next_results) => {
            if (latestQueryRef.current !== next) {
              return;
            }
            setResults(next_results);
            setStatus("ready");
            setError(null);
          })
          .catch((cause: unknown) => {
            if (latestQueryRef.current !== next) {
              return;
            }
            setResults([]);
            setStatus("error");
            setError(cause instanceof Error ? cause : new Error(String(cause)));
          });
      }, debounceMs);
    },
    [debounceMs]
  );

  return { query, search, results, status, error };
}
