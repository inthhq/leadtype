import {
  type AgentArtifactHandlerConfig,
  createAgentArtifactHandler,
  createLoadPage,
  joinUrlPath,
  type LoadPageConfig,
  listJoinedSlugs,
  normalizeUrlPath,
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
    // Without an override, each page's mount-aware `urlPath` *is* its route —
    // this is what makes `createPrerenderRoutes({ source })` correct for a
    // collection source (whose routePrefix is not `/docs`), for `mounts`, and
    // for a whole multi-collection project in one call.
    if (config.basePath === undefined) {
      const pages = await config.source.listPages();
      return pages.map((page) => normalizeUrlPath(page.urlPath));
    }
    // An explicit basePath re-roots the routes: pages are enumerated relative
    // to the source's own prefix, then joined onto the override. A page a
    // mount moved outside the source's prefix cannot be re-rooted and throws.
    const slugs = await listJoinedSlugs({ source: config.source });
    const basePath = config.basePath;
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
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function eventToRequest(event: NitroEventLike): Request {
  if (event.request) {
    return event.request;
  }
  const req = event.node?.req;
  const headers = req?.headers ?? {};
  const host =
    headerValue(headers, "host")?.split(",")[0]?.trim() || "localhost";
  const forwardedProto = headerValue(headers, "x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const proto = forwardedProto === "https" ? "https" : "http";
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
