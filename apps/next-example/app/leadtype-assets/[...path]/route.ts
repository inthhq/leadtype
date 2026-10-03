import {
  normalizeAgentReadabilityManifest,
  resolveManifestMarkdownMirrorTarget,
} from "leadtype/llm/readability";
import { createDocsRouteHandler } from "leadtype/next";
import manifestJson from "../../../public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);
const handler = createDocsRouteHandler({ manifest });
const markdownUrlByFilePath = new Map<string, string>();
for (const page of manifest.pages) {
  const target = resolveManifestMarkdownMirrorTarget(
    page.markdownUrlPath,
    manifest
  );
  if (target) {
    markdownUrlByFilePath.set(target.filePath, target.markdownUrlPath);
  }
}

interface AssetRouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(
  request: Request,
  context: AssetRouteContext
): Promise<Response> {
  const { path: segments } = await context.params;
  const hasUnsafeSegment = segments.some(
    (segment) =>
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0")
  );
  if (hasUnsafeSegment) {
    return new Response(null, { status: 404 });
  }
  const markdownUrlPath = markdownUrlByFilePath.get(segments.join("/"));
  if (!markdownUrlPath) {
    return new Response(null, { status: 404 });
  }
  return await handler(
    new Request(new URL(markdownUrlPath, request.url), {
      headers: request.headers,
    })
  );
}
