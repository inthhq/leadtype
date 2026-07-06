import { createFileRoute } from "@tanstack/react-router";
import {
  getProviderAnswerConfig,
  handleProviderAnswerRequest,
} from "@/lib/provider-answer";
import { jsonResponse } from "@/lib/search";

export const Route = createFileRoute("/api/docs/ask/tanstack")({
  server: {
    handlers: {
      GET: async () => jsonResponse(getProviderAnswerConfig("tanstack")),
      POST: async ({ request }) =>
        handleProviderAnswerRequest("tanstack", request),
    },
  },
});
