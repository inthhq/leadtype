import {
  type AgentArtifactHandlerConfig,
  createAgentArtifactHandler,
  createLoadPage,
  createPublicMarkdownReader,
  joinUrlPath,
  type LoadPageConfig,
  listJoinedSlugs,
  type StaticSlugConfig,
} from "../internal/framework";
import { createAgentMarkdownResponse } from "../llm/readability";
import type { DocsPage } from "../source";

export type AstroStaticPath = {
  params: { slug?: string };
};

export type AstroEndpointContext = {
  params?: { slug?: string };
  request: Request;
};

export type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "../llm/readability";
export type { DocsPage, DocsSource } from "../source";

export function createGetStaticPaths(
  config: StaticSlugConfig
): () => Promise<AstroStaticPath[]> {
  return async () => {
    const slugs = await listJoinedSlugs(config);
    return slugs.map((slug) => ({
      params: { slug: slug || undefined },
    }));
  };
}

export function createMarkdownStaticPaths(
  config: StaticSlugConfig
): () => Promise<AstroStaticPath[]> {
  return async () => {
    const slugs = await listJoinedSlugs(config);
    return slugs.map((slug) => ({
      params: { slug: slug || "index" },
    }));
  };
}

export function createLoadPageData(
  config: LoadPageConfig
): (slug: string | string[] | undefined) => Promise<DocsPage | null> {
  return createLoadPage(config);
}

export function createDocsEndpoint(
  config: AgentArtifactHandlerConfig
): (context: AstroEndpointContext) => Promise<Response> {
  const handler = createAgentArtifactHandler(config);
  const readMarkdownFile =
    config.readMarkdownFile ??
    createPublicMarkdownReader(config.publicDir ?? "./public");
  return async (context) => {
    if (context.params?.slug) {
      const url = new URL(context.request.url);
      const artifactBasePath = config.artifactBasePath ?? "/docs";
      const response = await createAgentMarkdownResponse({
        urlPath: joinUrlPath(artifactBasePath, `${context.params.slug}.md`),
        method: context.request.method,
        headers: {},
        manifest: config.manifest,
        readMarkdownFile,
        requestOrigin: url.origin,
        cacheControl: config.cacheControl,
      });
      return response ?? new Response(null, { status: 404 });
    }
    const response = await handler(context.request);
    return response ?? new Response(null, { status: 404 });
  };
}

export const createMarkdownEndpoint = createDocsEndpoint;
