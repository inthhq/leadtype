import { createFileRoute } from "@tanstack/react-router";
import {
  getProviderAnswerConfig,
  handleProviderAnswerRequest,
} from "@/lib/provider-answer";
import { jsonResponse } from "@/lib/search";

export const Route = createFileRoute("/api/docs/ask/cloudflare")({
  server: {
    handlers: {
      GET: async () => jsonResponse(getProviderAnswerConfig("cloudflare")),
      POST: async ({ request }) =>
        handleProviderAnswerRequest("cloudflare", request),
    },
  },
});
