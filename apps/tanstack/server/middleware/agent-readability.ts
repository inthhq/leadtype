import {
  createAgentMarkdownResponse,
  createRobotsTxtResponse,
  createSitemapMarkdownResponse,
  createSitemapXmlResponse,
} from "leadtype/llm/readability";
import {
  defineEventHandler,
  getHeaders,
  getMethod,
  getRequestURL,
} from "nitro/h3";
import {
  agentReadabilityManifest,
  getRequestOrigin,
  readMarkdownFile,
} from "../utils/agent-readability";

export default defineEventHandler(async (event) => {
  const method = getMethod(event);
  if (method !== "GET" && method !== "HEAD") {
    return;
  }

  const url = getRequestURL(event);
  const requestOrigin = getRequestOrigin(event);
  const pathname = url.pathname;

  switch (pathname) {
    case "/sitemap.xml":
      return createSitemapXmlResponse({
        manifest: agentReadabilityManifest,
        requestOrigin,
      });
    case "/sitemap.md":
      return createSitemapMarkdownResponse({
        manifest: agentReadabilityManifest,
        requestOrigin,
      });
    case "/robots.txt":
      return createRobotsTxtResponse({
        manifest: agentReadabilityManifest,
        requestOrigin,
      });
    default:
      break;
  }

  const response = await createAgentMarkdownResponse({
    urlPath: pathname,
    method,
    headers: getHeaders(event),
    manifest: agentReadabilityManifest,
    readMarkdownFile,
    requestOrigin,
  });
  return response ?? undefined;
});
