import { createDocsEndpoint, createMarkdownStaticPaths } from "leadtype/astro";
import type { AgentReadabilityManifest } from "leadtype/llm/readability";
import manifestJson from "../../../public/docs/agent-readability.json";
import { source } from "../../lib/source";

const manifest = {
  ...manifestJson,
  version: 1,
} as unknown as AgentReadabilityManifest;

export const getStaticPaths = createMarkdownStaticPaths({ source });

export const GET = createDocsEndpoint({
  manifest,
});

export const HEAD = GET;
