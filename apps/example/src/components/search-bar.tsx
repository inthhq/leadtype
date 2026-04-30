"use client";

import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";
import { SEARCH_MAX_QUERY_LENGTH, useDocsSearch } from "@/lib/use-docs-search";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 6;

const EXAMPLE_AI_QUESTIONS = [
  "How do I generate llms.txt for my docs?",
  "Which MDX components are available?",
  "How does AI search work in this site?",
  "How do I lint and convert my docs?",
];

function getSearchShortcutLabel() {
  if (typeof navigator === "undefined") {
    return "Ctrl+K";
  }

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  return platform.includes("mac") || userAgent.includes("mac")
    ? "⌘K"
    : "Ctrl+K";
}

/**
 * Cmd+K (or Ctrl+K) docs search popover. Reuses `useDocsSearch` so the popover
 * and the standalone /search page share one state machine. Shows live results
 * keyed by arrow keys, navigates to the chosen doc on Enter, and exposes the
 * AI answer flow inline via the same `/api/docs/ask` SSE the /search page uses.
 */
export function SearchBar() {
  const inputId = useId();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl+K");
  const search = useDocsSearch();
  const {
    answer,
    answerConfig,
    answerStatus,
    askAi,
    cancel,
    error,
    query,
    reset,
    results,
    searchStatus,
    setQuery,
  } = search;

  const open = useCallback(() => {
    setIsOpen(true);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    setShortcutLabel(getSearchShortcutLabel());
  }, []);

  const close = useCallback(() => {
    cancel();
    setIsOpen(false);
    triggerRef.current?.focus();
  }, [cancel]);

  // Global Cmd+K / Ctrl+K shortcut. Toggles the popover from anywhere in the
  // app — the modern docs-site keyboard convention (Algolia, Mintlify, etc.).
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const isToggle =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isToggle) {
        event.preventDefault();
        setIsOpen((current) => !current);
        return;
      }
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, isOpen]);

  // Autofocus the input on open; reset state on close.
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      return;
    }
    reset();
  }, [isOpen, reset]);

  // Close popover when navigation happens (e.g. user clicked a result).
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current !== pathname && isOpen) {
      setIsOpen(false);
    }
    lastPathRef.current = pathname;
  }, [isOpen, pathname]);

  const visibleResults = useMemo(
    () => results.slice(0, MAX_RESULTS),
    [results]
  );
  const visibleResultKey = useMemo(
    () => visibleResults.map((result) => result.id).join("|"),
    [visibleResults]
  );

  // Reset selection when results change.
  useEffect(() => {
    if (visibleResultKey || visibleResults.length === 0) {
      setActiveIndex(0);
    }
  }, [visibleResultKey, visibleResults.length]);

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.min(index + 1, Math.max(visibleResults.length - 1, 0))
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        const trimmed = query.trim();
        if (trimmed) {
          navigate({ to: "/search", search: { q: trimmed } });
          setIsOpen(false);
        }
        return;
      }
      const result = visibleResults[activeIndex];
      if (result) {
        event.preventDefault();
        navigate({ to: result.urlPath, hash: result.anchor || undefined });
      }
    }
  }

  const showEmptyState = !query.trim() && results.length === 0;
  const isAnswering =
    answerStatus === "loading" || answerStatus === "streaming";
  const canAsk = query.trim().length > 0 && answerConfig.enabled;

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className="inline-flex min-h-9 items-center gap-3 rounded-md border border-border bg-secondary/40 px-3 text-muted-foreground text-sm transition-colors hover:bg-secondary hover:text-foreground"
        onClick={open}
        ref={triggerRef}
        title={`Search docs (${shortcutLabel})`}
        type="button"
      >
        <SearchIcon />
        <span className="hidden sm:inline">Search docs</span>
        <kbd className="ml-2 hidden rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
          {shortcutLabel}
        </kbd>
      </button>

      {isOpen ? (
        <div
          aria-label="Search docs"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-4 pt-[12vh] backdrop-blur-sm"
          role="dialog"
        >
          <button
            aria-label="Close search"
            className="absolute inset-0 z-0 cursor-default"
            onClick={close}
            tabIndex={-1}
            type="button"
          />
          <div className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center gap-3 border-border border-b px-4">
              <SearchIcon />
              <label className="sr-only" htmlFor={inputId}>
                Search query
              </label>
              <input
                autoComplete="off"
                className="min-h-12 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                id={inputId}
                maxLength={SEARCH_MAX_QUERY_LENGTH}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search the docs or ask a question…"
                ref={inputRef}
                type="text"
                value={query}
              />
              {searchStatus === "loading" ? (
                <span className="text-muted-foreground text-xs">
                  Searching…
                </span>
              ) : null}
              <button
                className="rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-secondary hover:text-foreground"
                onClick={close}
                type="button"
              >
                Esc
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {showEmptyState ? (
                <EmptyState
                  onAskExample={(question) => {
                    askAi(question).catch(() => undefined);
                  }}
                  showAiExamples={answerConfig.enabled}
                />
              ) : null}

              {error ? (
                <p className="border-border border-b px-5 py-3 text-muted-foreground text-sm">
                  {error}
                </p>
              ) : null}

              {visibleResults.length > 0 ? (
                <ul className="divide-y divide-border">
                  {visibleResults.map((result, index) => (
                    <li key={result.id}>
                      <a
                        className={cn(
                          "block space-y-1 px-5 py-3 transition-colors hover:bg-secondary",
                          index === activeIndex && "bg-secondary"
                        )}
                        href={result.urlWithHash}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate({
                            to: result.urlPath,
                            hash: result.anchor || undefined,
                          });
                        }}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-foreground text-sm">
                            {result.title}
                          </h3>
                          {result.headingPath.length > 0 ? (
                            <span className="text-muted-foreground text-xs">
                              {result.headingPath.join(" / ")}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground text-xs leading-5">
                          {result.excerpt}
                        </p>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}

              {answer || isAnswering ? (
                <section className="border-border border-t px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-medium text-foreground text-sm">
                      Answer
                    </h3>
                    <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground text-xs">
                      {answerConfig.model}
                    </span>
                  </div>
                  <Streamdown
                    caret="block"
                    className="docs-answer text-sm"
                    controls={false}
                    isAnimating={answerStatus === "streaming"}
                  >
                    {answer || "Streaming…"}
                  </Streamdown>
                </section>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-border border-t bg-secondary/30 px-4 py-2 text-muted-foreground text-xs">
              <div className="flex items-center gap-3">
                <span>
                  <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">
                    ↑↓
                  </kbd>{" "}
                  navigate
                </span>
                <span>
                  <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">
                    ↵
                  </kbd>{" "}
                  open
                </span>
              </div>
              <button
                className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground text-xs transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canAsk || isAnswering}
                onClick={() => {
                  const askPromise = askAi();
                  askPromise.catch(() => undefined);
                }}
                type="button"
              >
                {isAnswering ? "Answering…" : "Ask AI"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function EmptyState({
  onAskExample,
  showAiExamples,
}: {
  onAskExample: (question: string) => void;
  showAiExamples: boolean;
}) {
  return (
    <div className="px-5 py-6">
      <p className="text-muted-foreground text-sm leading-6">
        Type a docs term such as <code>convert</code>, <code>llms.txt</code>, or{" "}
        <code>lint</code>. Press{" "}
        <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">
          ⌘↵
        </kbd>{" "}
        to open the full search page.
      </p>
      {showAiExamples ? (
        <div className="mt-5">
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Ask the AI
          </h4>
          <ul className="-mx-5 mt-2 divide-y divide-border border-border border-t">
            {EXAMPLE_AI_QUESTIONS.map((question) => (
              <li key={question}>
                <button
                  className="flex w-full items-center gap-3 px-5 py-3 text-left text-foreground text-sm transition-colors hover:bg-secondary"
                  onClick={() => onAskExample(question)}
                  type="button"
                >
                  <SparkleIcon />
                  <span>{question}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Search</title>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>AI</title>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="m5.6 5.6 2.1 2.1" />
      <path d="m16.3 16.3 2.1 2.1" />
      <path d="m5.6 18.4 2.1-2.1" />
      <path d="m16.3 7.7 2.1-2.1" />
    </svg>
  );
}
