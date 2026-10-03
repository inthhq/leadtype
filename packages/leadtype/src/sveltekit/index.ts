import {
  type AgentArtifactHandlerConfig,
  createAgentArtifactHandler,
  createLoadPage,
  type LoadPageConfig,
  listJoinedSlugs,
  type StaticSlugConfig,
} from "../internal/framework";
import type { DocsPage } from "../source";

export type SvelteKitEntry = {
  slug: string;
};

export type SvelteKitRequestEvent = {
  request: Request;
  params?: { slug?: string };
};

export type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "../llm/readability";
export type { DocsPage, DocsSource } from "../source";

export function createEntries(
  config: StaticSlugConfig
): () => Promise<SvelteKitEntry[]> {
  return async () => {
    const slugs = await listJoinedSlugs(config);
    return slugs.map((slug) => ({ slug }));
  };
}

export function createLoadPageData(
  config: LoadPageConfig
): (event: { params?: { slug?: string } }) => Promise<DocsPage | null> {
  const loadPage = createLoadPage(config);
  return async (event) => await loadPage(event.params?.slug);
}

export function createDocsServerHandler(
  config: AgentArtifactHandlerConfig
): (event: SvelteKitRequestEvent) => Promise<Response> {
  const handler = createAgentArtifactHandler(config);
  return async (event) => {
    const response = await handler(event.request);
    return response ?? new Response(null, { status: 404 });
  };
}

export const createMarkdownServerHandler = createDocsServerHandler;
