import {
  type AgentArtifactHandlerConfig,
  createAgentArtifactHandler,
  createLoadPage,
  joinUrlPath,
  type LoadPageConfig,
  listJoinedSlugs,
  type StaticSlugConfig,
} from "../internal/framework";
import type { DocsPage } from "../source";

export type NuxtRouteParams = {
  slug?: string | string[];
};

export type NitroEventLike = {
  request?: Request;
  node?: {
    req?: {
      method?: string;
      url?: string;
      headers?: Record<string, string | string[] | undefined>;
    };
  };
  path?: string;
};

export type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "../llm/readability";
export type { DocsPage, DocsSource } from "../source";

export function createPrerenderRoutes(
  config: StaticSlugConfig
): () => Promise<string[]> {
  return async () => {
    const slugs = await listJoinedSlugs(config);
    const basePath = config.basePath ?? "/docs";
    return slugs.map((slug) => joinUrlPath(basePath, slug));
  };
}

export function createLoadPageData(
  config: LoadPageConfig
): (params: NuxtRouteParams) => Promise<DocsPage | null> {
  const loadPage = createLoadPage(config);
  return async (params) => await loadPage(params.slug);
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function eventToRequest(event: NitroEventLike): Request {
  if (event.request) {
    return event.request;
  }
  const req = event.node?.req;
  const headers = req?.headers ?? {};
  const host = headerValue(headers, "host") ?? "localhost";
  const proto = headerValue(headers, "x-forwarded-proto") ?? "http";
  const url = new URL(event.path ?? req?.url ?? "/", `${proto}://${host}`);
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      requestHeaders.set(key, value.join(", "));
    } else if (value !== undefined) {
      requestHeaders.set(key, value);
    }
  }
  return new Request(url, {
    method: req?.method ?? "GET",
    headers: requestHeaders,
  });
}

export function createNitroDocsHandler(
  config: AgentArtifactHandlerConfig
): (event: NitroEventLike) => Promise<Response | null> {
  const handler = createAgentArtifactHandler(config);
  return async (event) => await handler(eventToRequest(event));
}

export function createRequiredNitroDocsHandler(
  config: AgentArtifactHandlerConfig
): (event: NitroEventLike) => Promise<Response> {
  const handler = createNitroDocsHandler(config);
  return async (event) =>
    (await handler(event)) ?? new Response(null, { status: 404 });
}
