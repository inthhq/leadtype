import type { AgentReadabilityManifest } from "leadtype/llm/readability";
import { createDocsProxy } from "leadtype/next";
import manifestJson from "./public/docs/agent-readability.json";

const manifest = {
  ...manifestJson,
  version: 1,
} as unknown as AgentReadabilityManifest;

export const proxy = createDocsProxy({ manifest });

export const config = {
  matcher: [
    "/docs/:path*",
    "/sitemap.xml",
    "/sitemap.md",
    "/robots.txt",
    "/docs/sitemap.xml",
    "/docs/sitemap.md",
    "/docs/robots.txt",
  ],
};
