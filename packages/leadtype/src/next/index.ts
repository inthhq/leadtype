import {
  type AgentArtifactHandlerConfig,
  createPublicMarkdownReader,
  createRequiredAgentArtifactHandler,
  joinUrlPath,
} from "../internal/framework";
import type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "../llm/readability";
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
   * Public route prefix where generated docs artifacts are mounted.
   *
   * @defaultValue `"/docs"`
   */
  artifactBasePath?: string;

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

/**
 * Build a Next App Router route handler that serves raw markdown for docs
 * pages and handles content negotiation (Accept: text/markdown, AI user
 * agents, explicit `.md` URLs).
 *
 * @remarks
 * Place the generated handler in a route segment that does not also define a
 * `page.tsx`. It returns markdown when the request is agent-readable and a 404
 * response otherwise.
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
    config.readMarkdownFile ?? createPublicMarkdownReader(publicDir);
  return createRequiredAgentArtifactHandler({
    manifest: config.manifest,
    artifactBasePath: config.artifactBasePath,
    publicDir,
    readMarkdownFile,
    cacheControl: config.cacheControl,
  });
}

export type CreateDocsProxyConfig = Pick<
  AgentArtifactHandlerConfig,
  "artifactBasePath" | "cacheControl" | "manifest"
> & {
  /**
   * Public URL prefix used to fetch generated markdown files from Next's static
   * asset serving inside Proxy.
   *
   * @defaultValue `"/"`
   */
  publicPathPrefix?: string;
};

/**
 * Build a Next Proxy handler for apps that serve human docs and markdown
 * mirrors from the same route tree.
 *
 * @remarks
 * Proxy cannot read from the filesystem, so this helper fetches generated
 * markdown from Next's static asset serving using the current request origin.
 *
 * @example
 * ```ts
 * export const proxy = createDocsProxy({ manifest });
 * ```
 */
export function createDocsProxy(
  config: CreateDocsProxyConfig
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const readMarkdownFile = async (target: MarkdownMirrorTarget) => {
      const response = await fetch(
        new URL(
          joinUrlPath(config.publicPathPrefix ?? "/", target.filePath),
          url
        )
      );
      return response.ok ? await response.text() : null;
    };
    const handler = createRequiredAgentArtifactHandler({
      manifest: config.manifest,
      artifactBasePath: config.artifactBasePath,
      readMarkdownFile,
      cacheControl: config.cacheControl,
    });
    return await handler(request);
  };
}
