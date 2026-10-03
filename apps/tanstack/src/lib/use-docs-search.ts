"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoSearchApiResult } from "@/lib/search";

export interface AnswerConfig {
  enabled: boolean;
  env?: Array<{ configured: boolean; label: string }>;
  model: string;
}

export type SearchStatus = "idle" | "loading" | "error";
export type AnswerStatus =
  | "idle"
  | "loading"
  | "streaming"
  | "error"
  | "disabled";

const SEARCH_DEBOUNCE_MS = 100;
export const SEARCH_MAX_QUERY_LENGTH = 400;

class AnswerRequestError extends Error {}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getAnswerFailureMessage(error: unknown): string {
  return error instanceof AnswerRequestError
    ? error.message
    : "Answer generation failed.";
}

async function readAnswerStream(
  response: Response,
  options: {
    isCurrent: () => boolean;
    onText: (text: string) => void;
    signal: AbortSignal;
  }
): Promise<string | undefined> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let streamedAnswer = "";
  while (true) {
    const chunk = await reader.read();
    if (options.signal.aborted || !options.isCurrent()) {
      await reader.cancel();
      return;
    }
    if (chunk.done) {
      break;
    }
    const text = decoder.decode(chunk.value, { stream: true });
    streamedAnswer += text;
    options.onText(text);
  }

  const remainingText = decoder.decode();
  if (remainingText) {
    streamedAnswer += remainingText;
    options.onText(remainingText);
  }
  return streamedAnswer;
}

async function readAnswerErrorMessage(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return data?.error ?? "Answer generation failed.";
}

async function streamDocsAnswer(options: {
  isCurrent: () => boolean;
  onText: (text: string) => void;
  query: string;
  signal: AbortSignal;
}): Promise<string | undefined> {
  const response = await fetch("/api/docs/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: options.query }),
    signal: options.signal,
  });
  if (!options.isCurrent()) {
    return;
  }
  if (!(response.ok && response.body)) {
    throw new AnswerRequestError(await readAnswerErrorMessage(response));
  }

  return readAnswerStream(response, {
    isCurrent: options.isCurrent,
    onText: options.onText,
    signal: options.signal,
  });
}

export interface UseDocsSearchResult {
  answer: string;
  answerConfig: AnswerConfig;
  answerStatus: AnswerStatus;
  /** Stream an AI-generated answer for the current query, or for `overrideQuery` if provided. */
  askAi: (overrideQuery?: string) => Promise<void>;
  /** Cancel any in-flight search and answer requests. */
  cancel: () => void;
  error: string;
  query: string;
  /** Reset to a clean state (clears query, results, answer, error). */
  reset: () => void;
  results: DemoSearchApiResult["results"];
  /** Run an immediate (non-debounced) search; useful for form submit. */
  runSearch: (signal?: AbortSignal) => Promise<DemoSearchApiResult["results"]>;
  searchStatus: SearchStatus;
  setQuery: (next: string) => void;
}

/**
 * Manages the shared search-and-stream state for both the header search popover
 * and the standalone /search page. Encapsulates debouncing, abort handling,
 * answer streaming, and the AI-answer config probe so the two surfaces stay
 * behaviorally identical.
 */
export function useDocsSearch(initialQuery = ""): UseDocsSearchResult {
  const searchTimeoutRef = useRef<number | undefined>(undefined);
  const searchControllerRef = useRef<AbortController | null>(null);
  const askControllerRef = useRef<AbortController | null>(null);
  const askRequestIdRef = useRef(0);
  const [query, setQueryState] = useState(initialQuery);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [answerStatus, setAnswerStatus] = useState<AnswerStatus>("idle");
  const [results, setResults] = useState<DemoSearchApiResult["results"]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [answerConfig, setAnswerConfig] = useState<AnswerConfig>({
    enabled: false,
    model: "loading",
  });

  useEffect(() => {
    let active = true;
    async function loadAnswerConfig() {
      const response = await fetch("/api/docs/ask");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as AnswerConfig;
      if (active) {
        setAnswerConfig(data);
        setAnswerStatus(data.enabled ? "idle" : "disabled");
      }
    }
    const configPromise = loadAnswerConfig();
    configPromise.catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const performSearch = useCallback(
    async (
      nextQuery: string,
      signal?: AbortSignal
    ): Promise<DemoSearchApiResult["results"]> => {
      const trimmedQuery = nextQuery.trim();
      if (!trimmedQuery) {
        return [];
      }

      try {
        setSearchStatus("loading");
        setError("");
        const response = await fetch(
          `/api/docs/search?q=${encodeURIComponent(trimmedQuery)}`,
          { signal }
        );
        const data = (await response.json()) as
          | DemoSearchApiResult
          | { error: string };

        if (!response.ok || "error" in data) {
          setSearchStatus("error");
          const message = "error" in data ? data.error : "Search failed.";
          setError(message);
          return [];
        }

        setResults(data.results);
        setSearchStatus("idle");
        return data.results;
      } catch (caughtError) {
        if (isAbortError(caughtError)) {
          if (
            !(signal && searchControllerRef.current) ||
            searchControllerRef.current.signal === signal
          ) {
            setSearchStatus("idle");
          }
          return [];
        }
        setSearchStatus("error");
        setError("Search failed.");
        return [];
      }
    },
    []
  );

  const cancelPendingSearch = useCallback(() => {
    if (searchTimeoutRef.current !== undefined) {
      window.clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = undefined;
    }
    searchControllerRef.current?.abort();
    searchControllerRef.current = null;
  }, []);

  const cancelPendingAnswer = useCallback(() => {
    askRequestIdRef.current += 1;
    askControllerRef.current?.abort();
    askControllerRef.current = null;
    setAnswerStatus(answerConfig.enabled ? "idle" : "disabled");
  }, [answerConfig.enabled]);

  const cancel = useCallback(() => {
    cancelPendingSearch();
    cancelPendingAnswer();
  }, [cancelPendingAnswer, cancelPendingSearch]);

  const setQuery = useCallback(
    (next: string) => {
      cancelPendingAnswer();
      setQueryState(next);
    },
    [cancelPendingAnswer]
  );

  // Debounced reactive search whenever the query changes.
  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      cancelPendingSearch();
      setResults([]);
      setSearchStatus("idle");
      setError("");
      return;
    }

    cancelPendingSearch();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    searchTimeoutRef.current = window.setTimeout(() => {
      searchTimeoutRef.current = undefined;
      const searchPromise = performSearch(trimmedQuery, controller.signal);
      searchPromise.finally(() => {
        if (searchControllerRef.current === controller) {
          searchControllerRef.current = null;
        }
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current !== undefined) {
        window.clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = undefined;
      }
      if (searchControllerRef.current === controller) {
        controller.abort();
        searchControllerRef.current = null;
      }
    };
  }, [cancelPendingSearch, performSearch, query]);

  // Cleanup on unmount.
  useEffect(
    () => () => {
      cancelPendingAnswer();
    },
    [cancelPendingAnswer]
  );

  const runSearch = useCallback(
    async (signal?: AbortSignal) => {
      cancelPendingSearch();
      cancelPendingAnswer();
      setAnswer("");
      const controller = signal ? null : new AbortController();
      const effectiveSignal = signal ?? controller?.signal;
      if (controller) {
        searchControllerRef.current = controller;
      }
      try {
        return await performSearch(query, effectiveSignal);
      } finally {
        if (controller && searchControllerRef.current === controller) {
          searchControllerRef.current = null;
        }
      }
    },
    [cancelPendingAnswer, cancelPendingSearch, performSearch, query]
  );

  const performAnswer = useCallback(
    async (trimmedQuery: string) => {
      if (!trimmedQuery) {
        return;
      }

      cancelPendingSearch();
      cancelPendingAnswer();
      const requestId = askRequestIdRef.current + 1;
      askRequestIdRef.current = requestId;
      const controller = new AbortController();
      askControllerRef.current = controller;

      const isCurrent = () =>
        !controller.signal.aborted && askRequestIdRef.current === requestId;

      const setAnswerError = (message: string) => {
        setAnswerStatus("error");
        setError(message);
      };

      try {
        setAnswer("");
        setError("");
        setAnswerStatus("loading");

        const sourceResults = await performSearch(
          trimmedQuery,
          controller.signal
        );
        if (!isCurrent()) {
          return;
        }
        if (sourceResults.length === 0) {
          setAnswerError("No matching docs were found for that question.");
          return;
        }

        setAnswerStatus("streaming");
        const streamedAnswer = await streamDocsAnswer({
          isCurrent,
          onText: (text) => setAnswer((current) => current + text),
          query: trimmedQuery,
          signal: controller.signal,
        });
        if (!isCurrent()) {
          return;
        }
        if (!streamedAnswer?.trim()) {
          setAnswerError(
            "The AI provider returned an empty answer. Check AI Gateway auth and model access."
          );
          return;
        }
        setAnswerStatus("idle");
      } catch (caughtError) {
        if (isAbortError(caughtError)) {
          return;
        }
        setAnswerError(getAnswerFailureMessage(caughtError));
      } finally {
        if (askControllerRef.current === controller) {
          askControllerRef.current = null;
        }
      }
    },
    [cancelPendingAnswer, cancelPendingSearch, performSearch]
  );

  const askAi = useCallback(
    async (overrideQuery?: string) => {
      const trimmedQuery = (overrideQuery ?? query).trim();
      if (overrideQuery !== undefined) {
        setQueryState(trimmedQuery);
      }
      await performAnswer(trimmedQuery);
    },
    [performAnswer, query]
  );

  const reset = useCallback(() => {
    cancel();
    setQueryState("");
    setResults([]);
    setAnswer("");
    setError("");
    setSearchStatus("idle");
    if (answerConfig.enabled) {
      setAnswerStatus("idle");
    }
  }, [answerConfig.enabled, cancel]);

  return {
    query,
    setQuery,
    results,
    searchStatus,
    answer,
    answerStatus,
    answerConfig,
    error,
    runSearch,
    askAi,
    cancel,
    reset,
  };
}
