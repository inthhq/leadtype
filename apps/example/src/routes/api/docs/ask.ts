import { createFileRoute } from "@tanstack/react-router";
import {
  getProviderAnswerConfig,
  handleProviderAnswerRequest,
} from "@/lib/provider-answer";
import { jsonResponse } from "@/lib/search";

export const Route = createFileRoute("/api/docs/ask")({
  server: {
    handlers: {
      GET: async () => jsonResponse(getProviderAnswerConfig("vercel")),
      POST: async ({ request }) =>
        handleProviderAnswerRequest("vercel", request),
    },
  },
});
