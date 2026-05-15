import { defineEventHandler } from "h3";
import type { AgentReadabilityManifest } from "leadtype/llm/readability";
import { createRequiredNitroDocsHandler } from "leadtype/nuxt";
import manifestJson from "../../../public/docs/agent-readability.json";

const manifest = {
  ...manifestJson,
  version: 1,
} as unknown as AgentReadabilityManifest;

export default defineEventHandler(
  createRequiredNitroDocsHandler({
    manifest,
  })
);
