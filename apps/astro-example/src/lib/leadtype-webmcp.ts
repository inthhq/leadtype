import { registerDocsWebMcpTools } from "leadtype/webmcp";

/**
 * Register the generated docs as browser WebMCP tools for this page's
 * lifetime. Astro pages are MPA documents, so unregister on pagehide.
 */
export function registerLeadtypeWebMcp(): void {
  const registration = registerDocsWebMcpTools();
  globalThis.addEventListener(
    "pagehide",
    () => {
      registration.unregister();
    },
    { once: true }
  );
}
