import { type Ref, ref, type ShallowRef, shallowRef } from "vue";
import {
  createSearchClient,
  type SearchClient,
  type SearchClientOptions,
} from "./client";
import type { DocsSearchResult } from "./search";

export type UseLeadtypeSearchOptions = SearchClientOptions;

/**
 * Vue refs returned by {@link useLeadtypeSearch}.
 */
export type UseLeadtypeSearchReturn = {
  query: Ref<string>;
  results: ShallowRef<DocsSearchResult[]>;
  status: Ref<"idle" | "loading" | "ready" | "error">;
  error: ShallowRef<Error | null>;
  search(query: string): Promise<void>;
  preload(): Promise<void>;
};

/**
 * Vue composable for querying generated Leadtype search artifacts.
 */
export function useLeadtypeSearch(
  collection: string,
  options: UseLeadtypeSearchOptions = {}
): UseLeadtypeSearchReturn {
  const client: SearchClient = createSearchClient(collection, options);
  const query = ref("");
  const results = shallowRef<DocsSearchResult[]>([]);
  const status = ref<UseLeadtypeSearchReturn["status"]["value"]>("idle");
  const error = shallowRef<Error | null>(null);
  let requestId = 0;

  async function search(next: string): Promise<void> {
    const currentRequestId = requestId + 1;
    requestId = currentRequestId;
    query.value = next;
    const trimmed = next.trim();
    if (trimmed.length === 0) {
      results.value = [];
      status.value = "idle";
      error.value = null;
      return;
    }
    status.value = "loading";
    try {
      const nextResults = await client.search(trimmed);
      if (requestId !== currentRequestId) {
        return;
      }
      results.value = nextResults;
      status.value = "ready";
      error.value = null;
    } catch (cause) {
      if (requestId !== currentRequestId) {
        return;
      }
      results.value = [];
      status.value = "error";
      error.value = cause instanceof Error ? cause : new Error(String(cause));
    }
  }

  return {
    query,
    results,
    status,
    error,
    search,
    preload: client.preload,
  };
}
