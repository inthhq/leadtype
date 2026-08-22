import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentReadabilityManifest,
  LocalizedAgentReadabilityManifests,
  MarkdownMirrorTarget,
  MarkdownReadErrorHandler,
  MissingMarkdownStatus,
} from "../llm/readability";
import {
  createAgentMarkdownResponse,
  createApiCatalogResponse,
  createRobotsTxtResponse,
  createSitemapMarkdownResponse,
  createSitemapXmlResponse,
} from "../llm/readability";
import type { DocsPage, DocsSource } from "../source";

export type ReadMarkdownFile = (
  target: MarkdownMirrorTarget
) => string | null | undefined | Promise<string | null | undefined>;

export type AgentArtifactHandlerConfig = {
  manifest: AgentReadabilityManifest;
  /** @deprecated Sitemap and robots artifacts are served at the origin root. */
  artifactBasePath?: string;
  publicDir?: string;
  readMarkdownFile?: ReadMarkdownFile;
  /** Generated locale manifests, keyed by locale code, for exact cross-locale reads. */
  localizedManifests?: LocalizedAgentReadabilityManifests;
  /** Observe reader failures before the handler returns its stable 500 response. */
  onReadError?: MarkdownReadErrorHandler;
  cacheControl?: string | null;
  /**
   * Status for a route with no page behind it. Defaults to `200`; pass `404`
   * to have unknown routes read as misses. A manifest-known page whose mirror
   * cannot be read still answers 500 either way.
   */
  missingStatus?: MissingMarkdownStatus;
};

export type LoadPageConfig = {
  source: DocsSource;
};

export type StaticSlugConfig = {
  source: DocsSource;
  /**
   * Public route prefix for generated framework routes.
   *
   * @defaultValue `"/docs"`
   */
  basePath?: string;
};

export function normalizeUrlPath(pathname: string): string {
  const normalized = `/${pathname}`.replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

export function joinUrlPath(...parts: string[]): string {
  return normalizeUrlPath(
    parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join("/")
  );
}

export function splitRouteSlug(slug: string | string[] | undefined): string[] {
  if (Array.isArray(slug)) {
    return slug;
  }
  if (!slug) {
    return [];
  }
  return slug.split("/").filter(Boolean);
}

export function joinRouteSlug(slug: string[]): string {
  return slug.join("/");
}

export function createLoadPage(
  config: LoadPageConfig
): (slug: string | string[] | undefined) => Promise<DocsPage | null> {
  return async (slug) => await config.source.loadPage(splitRouteSlug(slug));
}

export async function listJoinedSlugs(
  config: StaticSlugConfig
): Promise<string[]> {
  const pages = await config.source.listPages();
  return pages.map((page) => joinRouteSlug(page.slug));
}

export function isMissingFileError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function createPublicMarkdownReader(
  publicDir: string
): ReadMarkdownFile {
  const resolvedPublicDir = path.resolve(publicDir);
  return async (target) => {
    const candidate = path.resolve(resolvedPublicDir, target.filePath);
    const relative = path.relative(resolvedPublicDir, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  };
}

function getArtifactResponse(
  request: Request,
  config: AgentArtifactHandlerConfig
): Response | null {
  const url = new URL(request.url);
  const requestOrigin = url.origin;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return null;
  }
  const withoutHeadBody = (response: Response | null): Response | null => {
    if (!(response && method === "HEAD")) {
      return response;
    }
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  switch (url.pathname) {
    case "/sitemap.xml":
      return withoutHeadBody(
        createSitemapXmlResponse({
          manifest: config.manifest,
          requestOrigin,
          cacheControl: config.cacheControl,
        })
      );
    case "/sitemap.md":
      return withoutHeadBody(
        createSitemapMarkdownResponse({
          manifest: config.manifest,
          requestOrigin,
          cacheControl: config.cacheControl,
        })
      );
    case "/robots.txt":
      return withoutHeadBody(
        createRobotsTxtResponse({
          manifest: config.manifest,
          requestOrigin,
          cacheControl: config.cacheControl,
        })
      );
    // Returns null when the site publishes no APIs, so the well-known path
    // 404s instead of serving an empty catalog.
    case "/.well-known/api-catalog":
      return withoutHeadBody(
        createApiCatalogResponse({
          manifest: config.manifest,
          requestOrigin,
          method,
          cacheControl: config.cacheControl,
        })
      );
    default:
      return null;
  }
}

export function createAgentArtifactHandler(
  config: AgentArtifactHandlerConfig
): (request: Request) => Promise<Response | null> {
  const readMarkdownFile =
    config.readMarkdownFile ??
    createPublicMarkdownReader(config.publicDir ?? "./public");
  return async (request) => {
    const artifactResponse = getArtifactResponse(request, config);
    if (artifactResponse) {
      return artifactResponse;
    }
    const url = new URL(request.url);
    return await createAgentMarkdownResponse({
      urlPath: url.pathname,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      manifest: config.manifest,
      readMarkdownFile,
      requestOrigin: url.origin,
      cacheControl: config.cacheControl,
      ...(config.localizedManifests
        ? { localizedManifests: config.localizedManifests }
        : {}),
      ...(config.onReadError ? { onReadError: config.onReadError } : {}),
      ...(config.missingStatus ? { missingStatus: config.missingStatus } : {}),
    });
  };
}

export function createRequiredAgentArtifactHandler(
  config: AgentArtifactHandlerConfig
): (request: Request) => Promise<Response> {
  const handler = createAgentArtifactHandler(config);
  return async (request) => {
    const response = await handler(request);
    return response ?? new Response(null, { status: 404 });
  };
}
