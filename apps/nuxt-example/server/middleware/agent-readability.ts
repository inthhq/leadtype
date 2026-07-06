import { defineEventHandler } from "h3";
import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createNitroDocsHandler, type NitroEventLike } from "leadtype/nuxt";
import manifestJson from "../../public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

const handler = createNitroDocsHandler({
  manifest,
});

export default defineEventHandler(async (event) => {
  // Only short-circuit when this is an agent/artifact request. Returning the
  // handler's `null` directly would make h3 respond 204 and swallow every page
  // request — so fall through (return undefined) when there is no response.
  const response = await handler(event as NitroEventLike);
  if (response) {
    return response;
  }
});
