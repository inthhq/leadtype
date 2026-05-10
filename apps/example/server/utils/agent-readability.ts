import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentReadabilityManifest,
  MarkdownMirrorTarget,
} from "leadtype/llm/readability";
import {
  getHeader,
  getRequestProtocol,
  getRequestURL,
  type H3Event,
} from "nitro/h3";
import manifestJson from "../../src/generated/agent-readability.json" with {
  type: "json",
};

export const agentReadabilityManifest: AgentReadabilityManifest = {
  ...manifestJson,
  version: 1,
};

export function getRequestOrigin(event: H3Event): string | undefined {
  const forwardedHost = getHeader(event, "x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = getHeader(event, "x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost) {
    const protocol = forwardedProto || getRequestProtocol(event) || "http";
    return `${protocol}://${forwardedHost}`;
  }
  const url = getRequestURL(event);
  return url.origin;
}

export async function readMarkdownFile(
  target: MarkdownMirrorTarget
): Promise<string | null> {
  try {
    return await readFile(
      join(process.cwd(), "public", target.filePath),
      "utf8"
    );
  } catch {
    return null;
  }
}
