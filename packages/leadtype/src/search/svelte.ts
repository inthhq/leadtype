import { get, type Readable, type Writable, writable } from "svelte/store";
import {
  createSearchClient,
  type SearchClient,
  type SearchClientOptions,
} from "./client";
import type { DocsSearchResult } from "./search";

/**
 * Svelte store bundle returned by {@link createLeadtypeSearch}.
 */
export type LeadtypeSearchStore = {
  query: Writable<string>;
  results: Writable<DocsSearchResult[]>;
  status: Writable<"idle" | "loading" | "ready" | "error">;
  error: Writable<Error | null>;
  readonly state: Readable<{
    query: string;
    results: DocsSearchResult[];
    status: "idle" | "loading" | "ready" | "error";
    error: Error | null;
  }>;
  search(query: string): Promise<void>;
  preload(): Promise<void>;
};

/**
 * Build Svelte stores for querying generated Leadtype search artifacts.
 */
export function createLeadtypeSearch(
  collection: string,
  options: SearchClientOptions = {}
): LeadtypeSearchStore {
  const client: SearchClient = createSearchClient(collection, options);
  const query = writable("");
  const results = writable<DocsSearchResult[]>([]);
  const status = writable<"idle" | "loading" | "ready" | "error">("idle");
  const error = writable<Error | null>(null);
  let requestId = 0;
  const subscribers = new Set<
    (value: {
      query: string;
      results: DocsSearchResult[];
      status: "idle" | "loading" | "ready" | "error";
      error: Error | null;
    }) => void
  >();

  function snapshot() {
    return {
      query: get(query),
      results: get(results),
      status: get(status),
      error: get(error),
    };
  }

  function notify() {
    const value = snapshot();
    for (const subscriber of subscribers) {
      subscriber(value);
    }
  }

  query.subscribe(notify);
  results.subscribe(notify);
  status.subscribe(notify);
  error.subscribe(notify);

  async function search(next: string): Promise<void> {
    const currentRequestId = requestId + 1;
    requestId = currentRequestId;
    query.set(next);
    const trimmed = next.trim();
    if (trimmed.length === 0) {
      results.set([]);
      status.set("idle");
      error.set(null);
      return;
    }
    status.set("loading");
    try {
      const nextResults = await client.search(trimmed);
      if (requestId !== currentRequestId) {
        return;
      }
      results.set(nextResults);
      status.set("ready");
      error.set(null);
    } catch (cause) {
      if (requestId !== currentRequestId) {
        return;
      }
      results.set([]);
      status.set("error");
      error.set(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  return {
    query,
    results,
    status,
    error,
    state: {
      subscribe(run) {
        subscribers.add(run);
        run(snapshot());
        return () => subscribers.delete(run);
      },
    },
    search,
    preload: client.preload,
  };
}
