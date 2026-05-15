import {
  type AgentArtifactHandlerConfig,
  createAgentArtifactHandler,
  createLoadPage,
  type LoadPageConfig,
  listJoinedSlugs,
  type StaticSlugConfig,
} from "../internal/framework";
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
  return async (context) => {
    const response = await handler(context.request);
    return response ?? new Response(null, { status: 404 });
  };
}

export const createMarkdownEndpoint = createDocsEndpoint;
