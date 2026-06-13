import {
  createAgentDiscoveryHeaders,
  normalizeAgentReadabilityManifest,
} from "leadtype/llm/readability";
import { createDocsProxy } from "leadtype/next";
import { NextResponse } from "next/server";
import manifestJson from "./public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);
const handler = createDocsProxy({ manifest });

// The proxy handler resolves agent/markdown responses (content negotiation,
// sitemap, robots). It returns 404 when there is nothing agent-specific to
// serve — in that case fall through to the page instead of shadowing it.
export async function proxy(request: Request): Promise<Response> {
  const response = await handler(request);
  if (response.status === 404) {
    const next = NextResponse.next();
    if (new URL(request.url).pathname === "/") {
      for (const [key, value] of Object.entries(
        createAgentDiscoveryHeaders()
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
    "/docs/:path((?!.*\\.md$).*)",
    "/changelog/:path((?!.*\\.md$).*)",
    "/sitemap.xml",
    "/sitemap.md",
    "/robots.txt",
    "/.well-known/api-catalog",
    "/",
  ],
};
