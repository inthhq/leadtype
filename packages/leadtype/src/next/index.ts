import {
  type AgentArtifactHandlerConfig,
  createPublicMarkdownReader,
  createRequiredAgentArtifactHandler,
  joinUrlPath,
  splitRouteSlug,
} from "../internal/framework";
import type {
  AgentReadabilityManifest,
  AgentReadabilityPage,
  MarkdownMirrorTarget,
} from "../llm/readability";
import type { DocsPage, DocsSource } from "../source";

const SUPPORTED_MANIFEST_VERSION = 1;

export type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "../llm/readability";
export type { DocsPage, DocsSource } from "../source";

export type NextDocsMetadata = {
  title?: string;
  description?: string;
  alternates?: {
    canonical?: string;
    types?: Record<string, string>;
    [key: string]: unknown;
  };
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    type?: string;
    locale?: string;
    images?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type NextGenerateMetadataRouteProps = {
  params?: Promise<Record<string, unknown>>;
};

export type NextGenerateMetadataContext = {
  page: AgentReadabilityPage;
  manifest: AgentReadabilityManifest;
  urlPath: string;
  metadata: NextDocsMetadata;
};

type MaybePromise<T> = T | Promise<T>;

export type NextMetadataOverride<T> =
  | T
  | ((context: NextGenerateMetadataContext) => MaybePromise<T>);

export type CreateGenerateMetadataConfig = {
  /**
   * Agent Readability manifest emitted by `leadtype generate`.
   */
  manifest: AgentReadabilityManifest;

  /**
   * Public docs route prefix.
   *
   * @defaultValue `"/docs"`
   */
  basePath?: string;

  /**
   * Convert route props into the docs URL path. Override this when the route
   * params are not named `slug` or when docs live under a custom route shape.
   */
  resolveUrlPath?: (input: {
    params: Record<string, unknown> | undefined;
    slug: string[];
    basePath: string;
  }) => MaybePromise<string>;

  /**
   * Override the generated page title.
   *
   * When `openGraph.title` is not explicitly overridden, this also updates the
   * generated OpenGraph title so browser and social metadata stay in sync.
   */
  title?: NextMetadataOverride<string | undefined>;

  /**
   * Override the generated page description.
   *
   * When `openGraph.description` is not explicitly overridden, this also
   * updates the generated OpenGraph description.
   */
  description?: NextMetadataOverride<string | undefined>;

  /**
   * Merge OpenGraph metadata into the generated defaults. Explicit values here
   * win over `title` and `description` cascade behavior.
   */
  openGraph?: NextMetadataOverride<NextDocsMetadata["openGraph"]>;

  /**
   * Merge alternate links into the generated canonical and markdown alternate
   * defaults.
   */
  alternates?: NextMetadataOverride<NextDocsMetadata["alternates"]>;

  /**
   * Merge arbitrary framework metadata into the generated defaults after the
   * dedicated title, description, alternates, and OpenGraph overrides run.
   */
  metadata?: NextMetadataOverride<Partial<NextDocsMetadata> | undefined>;

  /**
   * Final hook for apps that need full control over the returned object. Runs
   * after every generated default and override has been applied.
   */
  transform?: (
    context: NextGenerateMetadataContext
  ) => MaybePromise<NextDocsMetadata>;
};

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

function pageTitle(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): string {
  return `${page.title} | ${manifest.product.name}`;
}

function pageDescription(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): string {
  return (
    page.description ||
    `${page.title} documentation for ${manifest.product.name}.`
  );
}

function assertManifestVersion(manifest: { version: number }): void {
  if (manifest.version !== SUPPORTED_MANIFEST_VERSION) {
    throw new Error(
      `leadtype: agent-readability manifest version ${manifest.version} is not supported (expected ${SUPPORTED_MANIFEST_VERSION}). Regenerate the manifest with the matching leadtype version.`
    );
  }
}

async function resolveOverride<T>(
  override: NextMetadataOverride<T> | undefined,
  context: NextGenerateMetadataContext
): Promise<T | undefined> {
  if (typeof override === "function") {
    return await (
      override as (context: NextGenerateMetadataContext) => MaybePromise<T>
    )(context);
  }
  return override;
}

function readRouteSlug(params: Record<string, unknown> | undefined): string[] {
  const slug = params?.slug;
  if (typeof slug === "string" || Array.isArray(slug)) {
    return splitRouteSlug(slug);
  }
  return [];
}

async function resolveRouteParams(
  params: NextGenerateMetadataRouteProps["params"]
): Promise<Record<string, unknown> | undefined> {
  return await params;
}

function createDefaultNextMetadata(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): NextDocsMetadata {
  const title = pageTitle(page, manifest);
  const description = pageDescription(page, manifest);
  return {
    title,
    description,
    alternates: {
      canonical: page.absoluteUrl,
      types: {
        "text/markdown": page.markdownAbsoluteUrl,
      },
    },
    openGraph: {
      title,
      description,
      url: page.absoluteUrl,
      type: "article",
      ...(page.locale ? { locale: page.locale } : {}),
    },
  };
}

function mergeAlternates(
  base: NextDocsMetadata["alternates"],
  override: NextDocsMetadata["alternates"]
): NextDocsMetadata["alternates"] {
  if (!override) {
    return base;
  }
  return {
    ...base,
    ...override,
    types: {
      ...base?.types,
      ...override.types,
    },
  };
}

function mergeOpenGraph(
  base: NextDocsMetadata["openGraph"],
  override: NextDocsMetadata["openGraph"]
): NextDocsMetadata["openGraph"] {
  if (!override) {
    return base;
  }
  return { ...base, ...override };
}

function mergeNextMetadata(
  base: NextDocsMetadata,
  override: Partial<NextDocsMetadata>
): NextDocsMetadata {
  return {
    ...base,
    ...override,
    alternates: override.alternates
      ? mergeAlternates(base.alternates, override.alternates)
      : base.alternates,
    openGraph: override.openGraph
      ? mergeOpenGraph(base.openGraph, override.openGraph)
      : base.openGraph,
  };
}

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
 * Build the function Next's App Router expects from `generateMetadata`.
 *
 * @example
 * ```ts
 * export const generateMetadata = createGenerateMetadata({ manifest });
 * ```
 */
export function createGenerateMetadata(
  config: CreateGenerateMetadataConfig
): (props: NextGenerateMetadataRouteProps) => Promise<NextDocsMetadata> {
  return async (props) => {
    assertManifestVersion(config.manifest);
    const params = await resolveRouteParams(props.params);
    const basePath = config.basePath ?? "/docs";
    const slug = readRouteSlug(params);
    const urlPath = config.resolveUrlPath
      ? await config.resolveUrlPath({ params, slug, basePath })
      : joinUrlPath(basePath, slug.join("/"));
    const page = config.manifest.pages.find(
      (entry) => entry.urlPath === urlPath
    );

    if (!page) {
      return {};
    }

    let metadata = createDefaultNextMetadata(page, config.manifest);
    let context: NextGenerateMetadataContext = {
      page,
      manifest: config.manifest,
      urlPath,
      metadata,
    };

    const title = await resolveOverride(config.title, context);
    if (title !== undefined) {
      metadata = {
        ...metadata,
        title,
        openGraph: {
          ...metadata.openGraph,
          title,
        },
      };
    }

    const description = await resolveOverride(config.description, {
      ...context,
      metadata,
    });
    if (description !== undefined) {
      metadata = {
        ...metadata,
        description,
        openGraph: {
          ...metadata.openGraph,
          description,
        },
      };
    }

    const alternates = await resolveOverride(config.alternates, {
      ...context,
      metadata,
    });
    if (alternates !== undefined) {
      metadata = {
        ...metadata,
        alternates: mergeAlternates(metadata.alternates, alternates),
      };
    }

    const openGraph = await resolveOverride(config.openGraph, {
      ...context,
      metadata,
    });
    if (openGraph !== undefined) {
      metadata = {
        ...metadata,
        openGraph: mergeOpenGraph(metadata.openGraph, openGraph),
      };
    }

    const extraMetadata = await resolveOverride(config.metadata, {
      ...context,
      metadata,
    });
    if (extraMetadata) {
      metadata = mergeNextMetadata(metadata, extraMetadata);
    }

    if (config.transform) {
      context = { ...context, metadata };
      return await config.transform(context);
    }

    return metadata;
  };
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
      try {
        const response = await fetch(
          new URL(
            joinUrlPath(config.publicPathPrefix ?? "/", target.filePath),
            url
          )
        );
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
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
