"use client";

import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useId } from "react";
import { Streamdown } from "streamdown";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SEARCH_MAX_QUERY_LENGTH, useDocsSearch } from "@/lib/use-docs-search";

export const Route = createFileRoute("/search")({
  component: SearchRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
});

function SearchRoute() {
  const inputId = useId();
  const { q: initialQuery } = Route.useSearch();
  const {
    answer,
    answerConfig,
    answerStatus,
    askAi,
    error,
    query,
    results,
    runSearch,
    searchStatus,
    setQuery,
  } = useDocsSearch(initialQuery ?? "tabs");

  // Pick up `?q=` deep links from the popover's Cmd+Enter expansion.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only route query changes should replace local input state.
  useEffect(() => {
    if (initialQuery && initialQuery !== query) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  function handleAsk() {
    const askPromise = askAi();
    askPromise.catch(() => undefined);
  }

  const canAsk = query.trim().length > 0 && answerConfig.enabled;
  const isAnswering =
    answerStatus === "loading" || answerStatus === "streaming";

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-6">
          <div className="space-y-3 border-border border-b pb-6">
            <p className="font-medium text-muted-foreground text-sm">
              Local index plus optional AI answer
            </p>
            <h1 className="font-heading font-medium text-4xl text-foreground tracking-tight">
              Search the docs
            </h1>
            <p className="max-w-2xl text-muted-foreground text-sm leading-6">
              Typing queries the generated static index through
              `/api/docs/search`. The model is called only when the Ask button
              is enabled and pressed. Press{" "}
              <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-xs">
                ⌘K
              </kbd>{" "}
              from anywhere to open the inline popover.
            </p>
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
              maxLength={SEARCH_MAX_QUERY_LENGTH}
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
                disabled={!canAsk || isAnswering}
                onClick={handleAsk}
                type="button"
              >
                {isAnswering ? "Answering" : "Ask"}
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
                Type a docs term such as install, tabs, or search.
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
              <Streamdown
                caret="block"
                className="docs-answer mt-4"
                controls={false}
                isAnimating={answerStatus === "streaming"}
              >
                {answer ||
                  "Ask a question to stream an answer grounded in the matching docs."}
              </Streamdown>
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
      <SiteFooter />
    </div>
  );
}
