"use client";

import { Link } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useId, useState } from "react";
import { Streamdown } from "streamdown";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  type DemoProviderId,
  type ProviderAnswerConfig,
  providerIds,
  providerSearchConfigs,
} from "@/lib/provider-search";
import type { DemoSearchApiResult } from "@/lib/search";
import { SEARCH_MAX_QUERY_LENGTH } from "@/lib/use-docs-search";

interface ProviderSearchTesterProps {
  provider: DemoProviderId;
  showChrome?: boolean;
}

type RequestStatus = "idle" | "loading" | "streaming" | "error";

const DEFAULT_QUERY = "How do CommandTabs work?";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readErrorMessage(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return data?.error ?? "Request failed.";
}

async function readStream(
  response: Response,
  onText: (text: string) => void
): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    const text = decoder.decode(chunk.value, { stream: true });
    fullText += text;
    onText(text);
  }

  const remainingText = decoder.decode();
  if (remainingText) {
    fullText += remainingText;
    onText(remainingText);
  }

  return fullText;
}

export function ProviderSearchTester({
  provider,
  showChrome = true,
}: ProviderSearchTesterProps) {
  const config = providerSearchConfigs[provider];
  const inputId = useId();
  const [answer, setAnswer] = useState("");
  const [answerConfig, setAnswerConfig] = useState<ProviderAnswerConfig | null>(
    null
  );
  const [error, setError] = useState("");
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [results, setResults] = useState<DemoSearchApiResult["results"]>([]);
  const [status, setStatus] = useState<RequestStatus>("idle");

  useEffect(() => {
    let active = true;
    setAnswerConfig(null);
    setError("");
    async function loadConfig() {
      const response = await fetch(`/api/docs/ask/${provider}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const data = (await response.json()) as ProviderAnswerConfig;
      if (active) {
        setError("");
        setAnswerConfig(data);
      }
    }
    const promise = loadConfig();
    promise.catch((caughtError: unknown) => {
      if (active) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Provider configuration failed."
        );
      }
    });
    return () => {
      active = false;
    };
  }, [provider]);

  async function runSearch(trimmedQuery: string) {
    const response = await fetch(
      `/api/docs/search?q=${encodeURIComponent(trimmedQuery)}`
    );
    const data = (await response.json()) as
      | DemoSearchApiResult
      | { error: string };

    if (!response.ok || "error" in data) {
      throw new Error("error" in data ? data.error : "Search failed.");
    }

    setResults(data.results);
  }

  async function runProviderAnswer() {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError("Enter a query.");
      return;
    }

    setAnswer("");
    setError("");
    setStatus("loading");

    try {
      await runSearch(trimmedQuery);
      setStatus("streaming");
      const response = await fetch(`/api/docs/ask/${provider}`, {
        body: JSON.stringify({ query: trimmedQuery }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!(response.ok && response.body)) {
        throw new Error(await readErrorMessage(response));
      }

      const streamedAnswer = await readStream(response, (text) => {
        setAnswer((current) => current + text);
      });

      if (!streamedAnswer.trim()) {
        throw new Error("The provider returned an empty answer.");
      }

      setStatus("idle");
    } catch (caughtError) {
      if (isAbortError(caughtError)) {
        setStatus("idle");
        return;
      }
      setStatus("error");
      setError(
        caughtError instanceof Error ? caughtError.message : "Request failed."
      );
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const promise = runProviderAnswer();
    promise.catch(() => undefined);
  }

  const isBusy = status === "loading" || status === "streaming";

  const content = (
    <>
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-6">
          <div className="space-y-3 border-border border-b pb-6">
            <p className="font-medium text-muted-foreground text-sm">
              {config.wrapper}
            </p>
            <h1 className="font-heading font-medium text-4xl text-foreground tracking-tight">
              {config.label} search
            </h1>
            <p className="max-w-2xl text-muted-foreground text-sm leading-6">
              {config.description}
            </p>
            <nav aria-label="Provider search routes" className="flex gap-2">
              {providerIds.map((providerId) => {
                const providerConfig = providerSearchConfigs[providerId];
                return (
                  <Link
                    className="rounded-md border border-border px-3 py-1.5 font-medium text-sm transition-colors hover:bg-secondary aria-[current=page]:bg-secondary"
                    key={providerId}
                    search={{ provider: providerId }}
                    to="/search"
                  >
                    {providerConfig.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className={
                  answerConfig?.enabled
                    ? "rounded-md bg-secondary px-2 py-1 font-medium text-foreground"
                    : "rounded-md border border-border px-2 py-1 text-muted-foreground"
                }
              >
                {answerConfig?.enabled ? "Configured" : "Not configured"}
              </span>
              <span className="text-muted-foreground">
                {answerConfig?.model ?? "loading"}
              </span>
            </div>

            <div className="space-y-2">
              <label className="font-medium text-sm" htmlFor={inputId}>
                Query
              </label>
              <textarea
                className="min-h-28 w-full resize-y rounded-lg border border-border bg-card px-4 py-3 text-base text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                id={inputId}
                maxLength={SEARCH_MAX_QUERY_LENGTH}
                onChange={(event) => setQuery(event.target.value)}
                value={query}
              />
            </div>

            <button
              className="min-h-11 rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isBusy}
              type="submit"
            >
              {isBusy ? "Running" : "Run"}
            </button>
          </form>

          {error ? (
            <p className="rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground text-sm">
              {error}
            </p>
          ) : null}

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-heading font-medium text-lg tracking-tight">
              Response
            </h2>
            <Streamdown
              caret="block"
              className="docs-answer mt-4"
              controls={false}
              isAnimating={status === "streaming"}
            >
              {answer || "No response yet."}
            </Streamdown>
          </section>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-heading font-medium text-lg tracking-tight">
              Runtime
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-medium">Wrapper</dt>
                <dd className="mt-1 text-muted-foreground">{config.wrapper}</dd>
              </div>
              <div>
                <dt className="font-medium">Provider credentials</dt>
                <dd className="mt-1 text-muted-foreground">
                  {answerConfig?.enabled ? "Configured" : "Not configured"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-heading font-medium text-lg tracking-tight">
              Environment
            </h2>
            <ul className="mt-4 space-y-3 text-sm">
              {(answerConfig?.env ?? config.env).map((requirement) => (
                <li className="space-y-1" key={requirement.label}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">
                      {requirement.label}
                    </span>
                    {"configured" in requirement ? (
                      <span
                        className={
                          requirement.configured
                            ? "rounded-md bg-secondary px-2 py-0.5 font-medium text-foreground text-xs"
                            : "rounded-md border border-border px-2 py-0.5 text-muted-foreground text-xs"
                        }
                      >
                        {requirement.configured ? "Set" : "Missing"}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-heading font-medium text-lg tracking-tight">
              Sources
            </h2>
            {results.length > 0 ? (
              <ol className="mt-4 space-y-3">
                {results.slice(0, 5).map((result, index) => (
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
                No sources yet.
              </p>
            )}
          </section>
        </aside>
      </main>
    </>
  );

  if (!showChrome) {
    return content;
  }

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      {content}
      <SiteFooter />
    </div>
  );
}
