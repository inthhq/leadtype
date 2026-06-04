import {
  createDocsHead as createDocsHeadCore,
  type DocsHead,
  normalizeAgentReadabilityManifest,
  renderSiteJsonLd,
  stringifyJsonLd,
} from "leadtype/llm/readability";
import agentReadability from "@/generated/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(agentReadability);

export function createDocsHead(urlPath: string): DocsHead {
  return createDocsHeadCore({ urlPath, manifest });
}

/**
 * The site-level JSON-LD graph (Organization, WebSite + SearchAction,
 * SoftwareApplication + SoftwareSourceCode), emitted once in the root head so
 * the per-page TechArticle `@id` references resolve. Options are derived from
 * `organization` + `product` and baked into the manifest at generate time.
 * TanStack Router's typed head API accepts JSON-LD through `scripts`.
 */
export function siteJsonLdScript(): {
  children: string;
  type: "application/ld+json";
} {
  return {
    children: stringifyJsonLd(renderSiteJsonLd(manifest)),
    type: "application/ld+json",
  };
}
