import {
  createDocsHead as createDocsHeadCore,
  type DocsHead,
  normalizeAgentReadabilityManifest,
  renderSiteJsonLd,
} from "leadtype/llm/readability";
import agentReadability from "@/generated/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(agentReadability);

export function createDocsHead(urlPath: string): DocsHead {
  return createDocsHeadCore({ urlPath, manifest });
}

/**
 * The site-level JSON-LD graph (Organization, WebSite + SearchAction,
 * SoftwareSourceCode), emitted once in the root head so the per-page TechArticle
 * `@id` references resolve. Options are derived from `organization` + `product` and
 * baked into the manifest at generate time.
 * TanStack renders a `script:ld+json` meta entry as a JSON-LD script tag.
 */
export function siteJsonLdMeta(): {
  "script:ld+json": Record<string, unknown>;
} {
  return { "script:ld+json": renderSiteJsonLd(manifest) };
}
