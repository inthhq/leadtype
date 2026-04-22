import {
  createMemoryRateLimiter,
  type DocsSearchContentStore,
  type DocsSearchIndex,
} from "@inth/docs/search";
import searchContent from "@/generated/docs-search-content.json";
import searchIndex from "@/generated/docs-search-index.json";

export const docsSearchIndex = searchIndex as unknown as DocsSearchIndex;
export const docsSearchContent =
  searchContent as unknown as DocsSearchContentStore;

export const docsSearchLimiters = {
  ask: createMemoryRateLimiter({
    limit: 10,
    windowMs: 60_000,
  }),
  search: createMemoryRateLimiter({
    limit: 60,
    windowMs: 60_000,
  }),
} as const;

export interface DemoSearchApiResult {
  results: Array<{
    id: string;
    title: string;
    description: string;
    urlPath: string;
    urlWithHash: string;
    absoluteUrl: string;
    absoluteUrlWithHash: string;
    anchor: string;
    headingPath: string[];
    excerpt: string;
    score: number;
  }>;
}

export function isAiAnswerEnabled(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  );
}

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}
