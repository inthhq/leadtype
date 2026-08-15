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

/**
 * The route base params are derived against: explicit `basePath`, else the
 * source's own prefix. `null` when neither is set — a hand-rolled source
 * that never opted into `routePrefix` keeps the historical slug-based
 * params rather than being forced under `/docs`.
 */
export function resolveRouteBase(config: {
  source: DocsSource;
  basePath?: string;
}): string | null {
  if (config.basePath !== undefined) {
    return normalizeUrlPath(config.basePath);
  }
  if (config.source.routePrefix !== undefined) {
    return normalizeUrlPath(config.source.routePrefix);
  }
  return null;
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
  if (base === null) {
    return pages.map((page) => page.slug);
  }
  return pages.map((page) => {
    const slug = routeSlugFromUrlPath(page.urlPath, base);
    if (slug === null) {
      throw new Error(
        `leadtype: page "${page.relativePath}${page.extension}" resolves to "${page.urlPath}", outside the route base "${base}" — a catch-all mounted at "${base}" cannot serve it. Mount a catch-all at the prefix that owns the page and pass that prefix as \`basePath\`; hand a multi-collection project that collection's source (\`project.getSource(key)\`); or pass \`basePath: "/"\` for a site-root catch-all. A same-tree \`mounts\` entry is not its own source — give the mount an empty pathPrefix so \`routePrefix\` is the catch-all, or split that subtree into its own collection.`
      );
    }
    return slug;
  });
}

function findPageByUrlPath(
  pages: DocsPageMeta[],
  urlPath: string
): DocsPageMeta | undefined {
  return pages.find(
    (page: DocsPageMeta) => normalizeUrlPath(page.urlPath) === urlPath
  );
}

export function createLoadPage(
  config: LoadPageConfig
): (slug: string | string[] | undefined) => Promise<DocsPage | null> {
  const base = resolveRouteBase(config);
  const sourceBase =
    config.source.routePrefix === undefined
      ? null
      : normalizeUrlPath(config.source.routePrefix);
  return async (slug) => {
    const segments = splitRouteSlug(slug);
    if (base === null) {
      return await config.source.loadPage(segments);
    }
    // Params are route segments under the base, so resolve them as the URL
    // they address. This is what keeps the load side symmetric with
    // `listRouteSlugs`: a mounted page whose params differ from its
    // collection-local slug must load, not 404.
    const routePath = joinUrlPath(base, ...segments);
    const pages = await config.source.listPages();
    // An explicit `basePath` re-roots (Nuxt prerender): slugs were taken
    // relative to the source prefix and joined onto the override. Reconstruct
    // the canonical urlPath so a mount that remapped the file slug still
    // loads instead of 404ing on the re-rooted path.
    const match =
      findPageByUrlPath(pages, routePath) ??
      (sourceBase === null || base === sourceBase
        ? undefined
        : findPageByUrlPath(pages, joinUrlPath(sourceBase, ...segments)));
    if (match) {
      // Route path wins over a colliding raw slug: generated params are
      // urlPath-derived, so `/docs/legacy` serves the page advertised there.
      // A project meta carries its collection; load by the canonical route,
      // which the project resolves uniquely. A plain source loads by slug.
      return await config.source.loadPage(
        "collection" in match ? normalizeUrlPath(match.urlPath) : match.slug
      );
    }
    // No page owns that URL under this base. Fall back to the historical
    // slug-based lookup so callers passing raw collection-local slugs keep
    // resolving when they do not collide with a mounted route.
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
