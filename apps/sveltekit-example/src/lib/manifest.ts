import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createDocsNavigation } from "leadtype/navigation";
import manifestJson from "../../static/docs/agent-readability.json";

/**
 * Single data spine: the agent-readability manifest emitted by
 * `leadtype generate` carries the navigation tree and page metadata.
 * `leadtype/navigation` derives sidebar, breadcrumbs, and prev/next.
 */
export const manifest = normalizeAgentReadabilityManifest(manifestJson);

export const nav = createDocsNavigation(manifest.navigation);

export function pageForUrlPath(urlPath: string) {
  return manifest.pages.find((page) => page.urlPath === urlPath) ?? null;
}
