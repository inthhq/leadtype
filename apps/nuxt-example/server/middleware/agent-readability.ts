import { defineEventHandler } from "h3";
import type { AgentReadabilityManifest } from "leadtype/llm/readability";
import { createNitroDocsHandler, type NitroEventLike } from "leadtype/nuxt";
import manifestJson from "../../public/docs/agent-readability.json";

const manifest = {
  ...manifestJson,
  version: 1,
} as unknown as AgentReadabilityManifest;

const handler = createNitroDocsHandler({
  manifest,
});

export default defineEventHandler(
  async (event) => await handler(event as NitroEventLike)
);
