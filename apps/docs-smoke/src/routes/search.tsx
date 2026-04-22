"use client";

import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import type { DemoSearchApiResult } from "@/lib/search";

interface AnswerConfig {
  enabled: boolean;
  model: string;
}

type SearchStatus = "idle" | "loading" | "error";
type AnswerStatus = "idle" | "loading" | "streaming" | "error" | "disabled";

const SEARCH_DEBOUNCE_MS = 250;

export const Route = createFileRoute("/search")({
  component: SearchRoute,
});

function SearchRoute() {
  const inputId = useId();
  const [query, setQuery] = useState("tabs");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [answerStatus, setAnswerStatus] = useState<AnswerStatus>("idle");
  const [results, setResults] = useState<DemoSearchApiResult["results"]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [answerConfig, setAnswerConfig] = useState<AnswerConfig>({
    enabled: false,
    model: "moonshotai/kimi-k2.6",
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

  const runSearch = useCallback(
    async (nextQuery: string, signal?: AbortSignal) => {
      const trimmedQuery = nextQuery.trim();
      if (!trimmedQuery) {
        return [];
      }

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
    },
    []
  );

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults([]);
      setSearchStatus("idle");
      setError("");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const searchPromise = runSearch(trimmedQuery, controller.signal);
      searchPromise.catch((caughtError: unknown) => {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }
        setSearchStatus("error");
        setError("Search failed.");
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, runSearch]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAnswer("");
    await runSearch(query);
  }

  async function handleAsk() {
    const trimmedQuery = query.trim();
    if (!(trimmedQuery && answerConfig.enabled)) {
      return;
    }

    try {
      setAnswer("");
      setError("");
      setAnswerStatus("loading");
      const nextResults = await runSearch(trimmedQuery);
      if (nextResults.length === 0) {
        setAnswerStatus("error");
        setError("No matching docs were found for that question.");
        return;
      }

      const response = await fetch("/api/docs/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: trimmedQuery }),
      });

      if (!(response.ok && response.body)) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setAnswerStatus("error");
        setError(data?.error ?? "Answer generation failed.");
        return;
      }

      setAnswerStatus("streaming");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamedAnswer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        const text = decoder.decode(chunk.value, { stream: true });
        streamedAnswer += text;
        setAnswer((current) => current + text);
      }
      const remainingText = decoder.decode();
      if (remainingText) {
        streamedAnswer += remainingText;
        setAnswer((current) => current + remainingText);
      }
      if (!streamedAnswer.trim()) {
        setAnswerStatus("error");
        setError(
          "The AI provider returned an empty answer. Check AI Gateway auth and model access."
        );
        return;
      }
      setAnswerStatus("idle");
    } catch {
      setAnswerStatus("error");
      setError("Answer generation failed.");
    }
  }

  const canAsk = query.trim().length > 0 && answerConfig.enabled;

  return (
    <div className="min-h-svh">
      <SiteHeader />
      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-6">
          <div className="space-y-3 border-border border-b pb-6">
            <p className="font-medium text-muted-foreground text-sm">
              @inth/docs search
            </p>
            <h1 className="font-heading font-medium text-4xl text-foreground tracking-tight">
              Search the docs
            </h1>
          </div>

          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={handleSearch}
          >
            <label className="sr-only" htmlFor={inputId}>
              Search query
            </label>
            <input
              className="min-h-11 flex-1 rounded-lg border border-border bg-card px-4 text-base text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              id={inputId}
              maxLength={600}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search docs or ask a question"
              value={query}
            />
            <div className="flex gap-2">
              <button
                className="min-h-11 rounded-lg border border-border bg-card px-4 font-medium text-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={searchStatus === "loading"}
                type="submit"
              >
                {searchStatus === "loading" ? "Searching" : "Search"}
              </button>
              <button
                className="min-h-11 rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  !canAsk ||
                  answerStatus === "loading" ||
                  answerStatus === "streaming"
                }
                onClick={handleAsk}
                type="button"
              >
                {answerStatus === "loading" || answerStatus === "streaming"
                  ? "Answering"
                  : "Ask"}
              </button>
            </div>
          </form>

          {error ? (
            <p className="rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground text-sm">
              {error}
            </p>
          ) : null}

          <section aria-live="polite" className="space-y-3">
            <h2 className="font-heading font-medium text-2xl tracking-tight">
              Results
            </h2>
            {results.length > 0 ? (
              <div className="divide-y divide-border rounded-lg border border-border bg-card">
                {results.map((result) => (
                  <a
                    className="block space-y-2 px-4 py-4 transition-colors hover:bg-secondary"
                    href={result.urlWithHash}
                    key={result.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-foreground">
                        {result.title}
                      </h3>
                      {result.headingPath.length > 0 ? (
                        <span className="text-muted-foreground text-xs">
                          {result.headingPath.join(" / ")}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-sm leading-6">
                      {result.excerpt}
                    </p>
                  </a>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-border border-dashed px-4 py-8 text-muted-foreground text-sm">
                No results yet.
              </p>
            )}
          </section>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading font-medium text-lg tracking-tight">
                Answer
              </h2>
              <span className="rounded-md bg-secondary px-2 py-1 text-muted-foreground text-xs">
                {answerConfig.model}
              </span>
            </div>
            {answerStatus === "disabled" ? (
              <p className="mt-4 text-muted-foreground text-sm leading-6">
                AI answers are disabled. Set AI_GATEWAY_API_KEY locally or use
                Vercel AI Gateway in deployment.
              </p>
            ) : (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7">
                {answer ||
                  "Ask a question to stream an answer grounded in the matching docs."}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-heading font-medium text-lg tracking-tight">
              Sources
            </h2>
            {results.length > 0 ? (
              <ol className="mt-4 space-y-3">
                {results.slice(0, 6).map((result, index) => (
                  <li className="text-sm" key={result.id}>
                    <a
                      className="font-medium underline underline-offset-4"
                      href={result.urlWithHash}
                    >
                      [{index + 1}] {result.title}
                    </a>
                    <p className="mt-1 text-muted-foreground leading-6">
                      {result.headingPath.join(" / ") || result.description}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 text-muted-foreground text-sm leading-6">
                Sources appear after a search.
              </p>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}
