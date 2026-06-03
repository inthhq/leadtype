import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createDocsNavigation } from "leadtype/navigation";
import manifestJson from "@/public/docs/agent-readability.json";

/**
 * The agent-readability manifest emitted by `leadtype generate` is the single
 * data spine for this app: it carries the navigation tree and every page's
 * metadata. `leadtype/navigation` derives the sidebar, breadcrumbs, and
 * prev/next from it — no framework-specific traversal in app code.
 */
export const manifest = normalizeAgentReadabilityManifest(manifestJson);

export const nav = createDocsNavigation(manifest.navigation);

export function pageForUrlPath(urlPath: string) {
  return manifest.pages.find((page) => page.urlPath === urlPath) ?? null;
}
