import {
  createAgentDiscoveryHeaders,
  normalizeAgentReadabilityManifest,
} from "leadtype/llm/readability";
import { createDocsProxy } from "leadtype/next";
import { NextResponse } from "next/server";
import manifestJson from "./public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);
const handler = createDocsProxy({
  manifest,
  publicPathPrefix: "/leadtype-assets",
});

// The proxy handler resolves agent/markdown responses (content negotiation,
// sitemap, robots). A bodyless 404 means there is nothing agent-specific to
// serve; a typed 404 can be the configured markdown recovery response.
export async function proxy(request: Request): Promise<Response> {
  const response = await handler(request);
  if (response.status === 404 && !response.headers.has("content-type")) {
    const next = NextResponse.next();
    if (new URL(request.url).pathname === "/") {
      for (const [key, value] of Object.entries(
        // The manifest decides whether an API catalog is advertised at all.
        createAgentDiscoveryHeaders({ manifest })
      )) {
        next.headers.set(key, value);
      }
    }
    return next;
  }
  return response;
}

export const config = {
  matcher: [
    "/docs/:path*",
    "/changelog/:path*",
    "/sitemap.xml",
    "/sitemap.md",
    "/robots.txt",
    "/.well-known/api-catalog",
    "/",
  ],
};
