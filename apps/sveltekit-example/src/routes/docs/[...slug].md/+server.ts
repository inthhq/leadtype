import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createDocsServerHandler } from "leadtype/sveltekit";
import manifestJson from "../../../../static/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

export const GET = createDocsServerHandler({
  manifest,
  publicDir: "static",
});

export const HEAD = GET;
