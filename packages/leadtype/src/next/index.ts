import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "../llm/readability";
import { createAgentMarkdownResponse } from "../llm/readability";
import type { DocsPage, DocsSource } from "../source";

export type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "../llm/readability";
export type { DocsPage, DocsSource } from "../source";

/**
 * Configuration for {@link createGenerateStaticParams}.
 */
export type CreateGenerateStaticParamsConfig = {
  /**
   * Framework-neutral docs source used to enumerate all known pages.
   */
  source: DocsSource;
};

/**
 * Configuration for {@link createLoadPageData}.
 */
export type CreateLoadPageDataConfig = {
  /**
   * Framework-neutral docs source used to resolve route slugs.
   */
  source: DocsSource;
};

/**
 * Configuration for {@link createDocsRouteHandler}.
 */
export type CreateDocsRouteHandlerConfig = {
  /**
   * Agent Readability manifest emitted by `leadtype generate`.
   */
  manifest: AgentReadabilityManifest;

  /**
   * Directory where `leadtype generate` wrote public artifacts.
   *
   * @defaultValue `"./public"`
   */
  publicDir?: string;

  /**
   * Cache-Control header for markdown responses.
   *
   * Pass `null` to omit the header.
   */
  cacheControl?: string | null;

  /**
   * Custom markdown reader for a resolved generated markdown target.
   *
   * @remarks
   * Defaults to reading `<publicDir>/<target.filePath>` with `node:fs`.
   * Override this when serving from a CDN, KV store, in-memory map, or other
   * non-filesystem artifact source.
   */
  readMarkdownFile?: (
    target: MarkdownMirrorTarget
  ) => string | null | undefined | Promise<string | null | undefined>;
};

/**
 * Build the function Next's App Router expects from `generateStaticParams`.
 *
 * @example
 * ```ts
 * export const generateStaticParams = createGenerateStaticParams({ source });
 * ```
 */
export function createGenerateStaticParams(
  config: CreateGenerateStaticParamsConfig
): () => Promise<Array<{ slug: string[] }>> {
  return async () => {
    const pages = await config.source.listPages();
    return pages.map((page) => ({ slug: page.slug }));
  };
}

/**
 * Build a page-data loader for a Next server component or `generateMetadata`.
 *
 * @returns A loader that returns `null` for unknown slugs so callers can use
 * Next's `notFound()`.
 *
 * @example
 * ```ts
 * const loadPageData = createLoadPageData({ source });
 * const page = await loadPageData(slug);
 * ```
 */
export function createLoadPageData(
  config: CreateLoadPageDataConfig
): (slug: string[] | undefined) => Promise<DocsPage | null> {
  return async (slug) => await config.source.loadPage(slug ?? []);
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function createDefaultMarkdownReader(
  publicDir: string
): (target: MarkdownMirrorTarget) => Promise<string | null> {
  const resolvedPublicDir = path.resolve(publicDir);
  return async (target) => {
    // `target.filePath` is derived from a path that has already been guarded
    // against `..` segments by `resolveMarkdownMirrorTarget`. Resolve once
    // more and reject anything that escapes `publicDir` — defense in depth in
    // case a future caller passes a hand-built target.
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

/**
 * Build a Next App Router route handler that serves raw markdown for docs
 * pages and handles content negotiation (Accept: text/markdown, AI user
 * agents, explicit `.md` URLs).
 *
 * @remarks
 * Place the generated handler at `app/docs/[[...slug]]/route.ts` next to the
 * matching `page.tsx`. It returns markdown when the request is agent-readable
 * and a 404 response otherwise.
 *
 * @example
 * ```ts
 * import { createDocsRouteHandler } from "leadtype/next";
 * import manifest from "@/generated/agent-readability.json" with { type: "json" };
 *
 * export const GET = createDocsRouteHandler({
 *   manifest: { ...manifest, version: 1 } as const,
 * });
 * ```
 */
export function createDocsRouteHandler(
  config: CreateDocsRouteHandlerConfig
): (request: Request) => Promise<Response> {
  const publicDir = config.publicDir ?? "./public";
  const readMarkdownFile =
    config.readMarkdownFile ?? createDefaultMarkdownReader(publicDir);
  return async (request) => {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const response = await createAgentMarkdownResponse({
      urlPath: url.pathname,
      method: request.method,
      headers,
      manifest: config.manifest,
      readMarkdownFile,
      requestOrigin: url.origin,
      cacheControl: config.cacheControl,
    });
    return response ?? new Response(null, { status: 404 });
  };
}
