import type {
  DocsSearchContentStore,
  DocsSearchIndex,
  DocsSearchResult,
} from "./search";
import { searchDocs } from "./search";

export type { DocsSearchResult } from "./search";

/**
 * Options shared by framework-specific search helpers and the vanilla client.
 */
export type SearchClientOptions = {
  /**
   * URL for the generated search index JSON.
   *
   * @defaultValue `/${collection}/search-index.json`
   */
  indexUrl?: string;

  /**
   * URL for the generated search content JSON.
   *
   * @defaultValue `/${collection}/search-content.json`
   */
  contentUrl?: string;

  /**
   * Maximum number of search results returned per query.
   */
  limit?: number;

  /**
   * Fetch implementation used to load generated artifacts.
   */
  fetch?: typeof fetch;
};

/**
 * Framework-neutral search client over generated Leadtype search artifacts.
 */
export type SearchClient = {
  /**
   * Run a search query.
   */
  search(query: string): Promise<DocsSearchResult[]>;

  /**
   * Load generated search artifacts before the first query.
   */
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
      `leadtype/search/client: failed to fetch ${url} (${response.status} ${response.statusText})`
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
 * Resolve the generated search artifact URLs for a collection.
 */
export function resolveSearchArtifactUrls(
  collection: string,
  options: SearchClientOptions = {}
): { indexUrl: string; contentUrl: string } {
  return {
    indexUrl: options.indexUrl ?? `/${collection}/search-index.json`,
    contentUrl: options.contentUrl ?? `/${collection}/search-content.json`,
  };
}

/**
 * Build a framework-free search client. Use directly from a worker, plain
 * script, custom element, or framework integration.
 *
 * @example
 * ```ts
 * const client = createSearchClient("docs");
 * const results = await client.search("install");
 * ```
 */
export function createSearchClient(
  collection: string,
  options: SearchClientOptions = {}
): SearchClient {
  const { indexUrl, contentUrl } = resolveSearchArtifactUrls(
    collection,
    options
  );
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      "leadtype/search/client: no fetch implementation available. Pass `options.fetch` when running in an environment without globalThis.fetch."
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
