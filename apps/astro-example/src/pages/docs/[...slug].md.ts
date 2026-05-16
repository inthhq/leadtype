import { createDocsEndpoint, createMarkdownStaticPaths } from "leadtype/astro";
import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import manifestJson from "../../../public/docs/agent-readability.json";
import { source } from "../../lib/source";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

export const getStaticPaths = createMarkdownStaticPaths({ source });

export const GET = createDocsEndpoint({
  manifest,
});

export const HEAD = GET;
