import {
  type AgentArtifactHandlerConfig,
  createAgentArtifactHandler,
  createLoadPage,
  type LoadPageConfig,
  listJoinedSlugs,
  type StaticSlugConfig,
  splitRouteSlug,
} from "../internal/framework";
import type { DocsPage } from "../source";

export type TanStackStaticParams = {
  _splat: string;
};

export type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "../llm/readability";
export type { DocsPage, DocsSource } from "../source";

export function createStaticParams(
  config: StaticSlugConfig
): () => Promise<TanStackStaticParams[]> {
  return async () => {
    const slugs = await listJoinedSlugs(config);
    return slugs.map((slug) => ({ _splat: slug }));
  };
}

export function createLoadPageData(
  config: LoadPageConfig
): (splat: string | undefined) => Promise<DocsPage | null> {
  const loadPage = createLoadPage(config);
  return async (splat) => await loadPage(splitRouteSlug(splat));
}

export function createDocsServerHandler(
  config: AgentArtifactHandlerConfig
): (request: Request) => Promise<Response> {
  const handler = createAgentArtifactHandler(config);
  return async (request) => {
    const response = await handler(request);
    return response ?? new Response(null, { status: 404 });
  };
}

export const createMarkdownServerHandler = createDocsServerHandler;
