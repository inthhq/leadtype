import { defineEventHandler } from "h3";
import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createNitroDocsHandler, type NitroEventLike } from "leadtype/nuxt";
import manifestJson from "../../public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

const handler = createNitroDocsHandler({
  manifest,
});

export default defineEventHandler(
  async (event) => await handler(event as NitroEventLike)
);
