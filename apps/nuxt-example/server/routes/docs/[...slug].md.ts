import { defineEventHandler } from "h3";
import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createRequiredNitroDocsHandler } from "leadtype/nuxt";
import manifestJson from "../../../public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

export default defineEventHandler(
  createRequiredNitroDocsHandler({
    manifest,
  })
);
