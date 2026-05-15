import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createDocsProxy } from "leadtype/next";
import manifestJson from "./public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

export const proxy = createDocsProxy({ manifest });

export const config = {
  matcher: [
    "/docs/:path((?!.*\\.md$).*)",
    "/sitemap.xml",
    "/sitemap.md",
    "/robots.txt",
    "/docs/sitemap.xml",
    "/docs/sitemap.md",
    "/docs/robots.txt",
  ],
};
