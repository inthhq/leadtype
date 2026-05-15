import type { AgentReadabilityManifest } from "leadtype/llm/readability";
import { createDocsServerHandler } from "leadtype/sveltekit";
import manifestJson from "../../../../static/docs/agent-readability.json";

const manifest = {
  ...manifestJson,
  version: 1,
} as unknown as AgentReadabilityManifest;

export const GET = createDocsServerHandler({
  manifest,
  publicDir: "static",
});

export const HEAD = GET;
