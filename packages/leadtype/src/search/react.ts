"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSearchClient,
  resolveSearchArtifactUrls,
  type SearchClient,
  type SearchClientOptions,
} from "./client";
import type { DocsSearchResult } from "./search";

/**
 * Options for the React search hook.
 */
export type UseLeadtypeSearchOptions = SearchClientOptions & {
  /**
   * Delay in milliseconds between query updates and BM25 execution.
   *
   * @defaultValue `120`
   */
  debounceMs?: number;
};

/**
 * State returned by {@link useLeadtypeSearch}.
 */
export type UseLeadtypeSearchReturn = {
  query: string;
  search(query: string): void;
  results: DocsSearchResult[];
  status: "idle" | "loading" | "ready" | "error";
  error: Error | null;
};

const DEFAULT_DEBOUNCE_MS = 120;

/**
 * React hook returning debounced Leadtype search state.
 *
 * @example
 * ```tsx
 * const { query, search, results, status } = useLeadtypeSearch("docs");
 * ```
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
  const clientRef = useRef<SearchClient | null>(null);
  const { indexUrl, contentUrl } = resolveSearchArtifactUrls(
    collection,
    options
  );
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
          .then((nextResults) => {
            if (latestQueryRef.current !== next) {
              return;
            }
            setResults(nextResults);
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
