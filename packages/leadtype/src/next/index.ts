/**
 * `leadtype/next` — server-only adapter for Next.js App Router.
 *
 * Thin wiring over leadtype's framework-neutral primitives so a Next docs app
 * can be a one-liner per file. No React imports — server entries only.
 *
 * ```ts title="app/docs/[[...slug]]/page.tsx"
 * import { createLoadPageData, createGenerateStaticParams } from "leadtype/next";
 * import { source } from "@/lib/source";
 *
 * const loadPageData = createLoadPageData({ source });
 *
 * export async function generateStaticParams() {
 *   return await createGenerateStaticParams({ source })();
 * }
 *
 * export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
 *   const page = await loadPageData((await params).slug);
 *   if (!page) notFound();
 *   // render page.markdown with your MDX runtime
 * }
 * ```
 *
 * ```ts title="app/docs/[[...slug]]/route.ts"
 * import { createDocsRouteHandler } from "leadtype/next";
 * import manifest from "@/generated/agent-readability.json" assert { type: "json" };
 *
 * export const GET = createDocsRouteHandler({
 *   manifest: { ...manifest, version: 1 } as const,
 * });
 * ```
 *
 * Pair with `useLeadtypeSearch` from `leadtype/next/client` for in-app search.
 */

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

export type CreateGenerateStaticParamsConfig = {
  source: DocsSource;
};

export type CreateLoadPageDataConfig = {
  source: DocsSource;
};

export type CreateDocsRouteHandlerConfig = {
  /** Agent-readability manifest emitted by `leadtype generate`. */
  manifest: AgentReadabilityManifest;
  /**
   * Directory where the generate CLI wrote artifacts. Default: `./public`
   * (resolved relative to `process.cwd()` at request time).
   */
  publicDir?: string;
  /** Override Cache-Control. Pass `null` to omit. */
  cacheControl?: string | null;
  /**
   * Custom markdown reader. Defaults to reading `<publicDir>/<target.filePath>`
   * with `node:fs`. Override to read from a CDN, KV, or in-memory map.
   */
  readMarkdownFile?: (
    target: MarkdownMirrorTarget
  ) => string | null | undefined | Promise<string | null | undefined>;
};

/**
 * Build the function Next's App Router expects from `generateStaticParams`.
 *
 * @example
 * export const generateStaticParams = createGenerateStaticParams({ source });
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
 * Returns `null` for unknown slugs so the caller can call `notFound()`.
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
 * Place at `app/docs/[[...slug]]/route.ts` alongside the existing `page.tsx`.
 * The route handler returns markdown when appropriate and `null`-equivalent
 * (404) when not, letting Next fall through to the page render for HTML.
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
