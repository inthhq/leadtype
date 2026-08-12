import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "../llm/readability";
import {
  createAgentMarkdownResponse,
  createApiCatalogResponse,
  createRobotsTxtResponse,
  createSitemapMarkdownResponse,
  createSitemapXmlResponse,
} from "../llm/readability";
import type { DocsPage, DocsPageMeta, DocsSource } from "../source";

export type ReadMarkdownFile = (
  target: MarkdownMirrorTarget
) => string | null | undefined | Promise<string | null | undefined>;

export type AgentArtifactHandlerConfig = {
  manifest: AgentReadabilityManifest;
  /** @deprecated Sitemap and robots artifacts are served at the origin root. */
  artifactBasePath?: string;
  publicDir?: string;
  readMarkdownFile?: ReadMarkdownFile;
  cacheControl?: string | null;
};

export type LoadPageConfig = {
  source: DocsSource;
  /**
   * Route prefix the consuming catch-all is mounted at. Params are resolved as
   * `urlPath` segments relative to it, so a page a mount moved elsewhere under
   * the prefix still loads. Pass `"/"` for a site-root catch-all.
   *
   * @defaultValue the source's own `routePrefix` (`"/docs"` when absent)
   */
  basePath?: string;
};

export type StaticSlugConfig = {
  source: DocsSource;
  /**
   * Route prefix the catch-all consuming these params is mounted at. Params
   * are each page's `urlPath` relative to it. Pass `"/"` for a site-root
   * catch-all serving every collection.
   *
   * @defaultValue the source's own `routePrefix` (`"/docs"` when absent)
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

/** The route base params are derived against: explicit `basePath`, else the source's own prefix. */
export function resolveRouteBase(config: {
  source: DocsSource;
  basePath?: string;
}): string {
  return normalizeUrlPath(
    config.basePath ?? config.source.routePrefix ?? "/docs"
  );
}

/**
 * A page's route params under `base`: its mount-aware `urlPath` relative to
 * the base. `null` when the page's URL lives outside the base — a catch-all
 * mounted there cannot serve it.
 */
function routeSlugFromUrlPath(urlPath: string, base: string): string[] | null {
  const normalized = normalizeUrlPath(urlPath);
  if (base === "/") {
    return normalized.split("/").filter(Boolean);
  }
  if (normalized === base) {
    return [];
  }
  if (normalized.startsWith(`${base}/`)) {
    return normalized
      .slice(base.length + 1)
      .split("/")
      .filter(Boolean);
  }
  return null;
}

/**
 * Enumerate every page's route params relative to the resolved base.
 *
 * Derived from `urlPath`, not the collection-local `slug`, so `mounts` and a
 * collection's `routePrefix` are honoured: for an unmounted single collection
 * the two are identical, and where they differ the `slug` was the wrong
 * answer — it rendered a page at a URL the generated sitemap never advertises.
 * A page outside the base throws instead of silently misrouting.
 */
export async function listRouteSlugs(
  config: StaticSlugConfig
): Promise<string[][]> {
  const base = resolveRouteBase(config);
  const pages = await config.source.listPages();
  return pages.map((page) => {
    const slug = routeSlugFromUrlPath(page.urlPath, base);
    if (slug === null) {
      throw new Error(
        `leadtype: page "${page.relativePath}${page.extension}" resolves to "${page.urlPath}", outside the route base "${base}" — a catch-all mounted at "${base}" cannot serve it. Mount a catch-all at the prefix that owns the page and hand it that collection's source (\`project.getSource(key)\`), or pass the base your catch-all is actually mounted at via \`basePath\` ("/" for a site-root catch-all).`
      );
    }
    return slug;
  });
}

export function createLoadPage(
  config: LoadPageConfig
): (slug: string | string[] | undefined) => Promise<DocsPage | null> {
  const base = resolveRouteBase(config);
  return async (slug) => {
    const segments = splitRouteSlug(slug);
    // Params are route segments under the base, so resolve them as the URL
    // they address. This is what keeps the load side symmetric with
    // `listRouteSlugs`: a mounted page whose params differ from its
    // collection-local slug must load, not 404.
    const routePath = joinUrlPath(base, ...segments);
    const pages = await config.source.listPages();
    const match = pages.find(
      (page: DocsPageMeta) => normalizeUrlPath(page.urlPath) === routePath
    );
    if (match) {
      // A project meta carries its collection; load by route path, which the
      // project resolves uniquely — a collection-local slug can be ambiguous
      // across collections. A plain source loads by its exact slug.
      return await config.source.loadPage(
        "collection" in match ? routePath : match.slug
      );
    }
    // No page owns that URL under this base. Fall back to the historical
    // slug-based lookup so callers passing raw collection-local slugs (or
    // using a base that differs from the source's own prefix) keep resolving.
    return await config.source.loadPage(segments);
  };
}

export async function listJoinedSlugs(
  config: StaticSlugConfig
): Promise<string[]> {
  return (await listRouteSlugs(config)).map(joinRouteSlug);
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
  switch (url.pathname) {
    case "/sitemap.xml":
      return createSitemapXmlResponse({
        manifest: config.manifest,
        requestOrigin,
        cacheControl: config.cacheControl,
      });
    case "/sitemap.md":
      return createSitemapMarkdownResponse({
        manifest: config.manifest,
        requestOrigin,
        cacheControl: config.cacheControl,
      });
    case "/robots.txt":
      return createRobotsTxtResponse({
        manifest: config.manifest,
        requestOrigin,
        cacheControl: config.cacheControl,
      });
    case "/.well-known/api-catalog":
      return createApiCatalogResponse({
        manifest: config.manifest,
        requestOrigin,
        cacheControl: config.cacheControl,
      });
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
