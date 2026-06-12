import { createFileRoute } from "@tanstack/react-router";
import { createAskHandler } from "leadtype/nlweb";

// Mounts the NLWeb /ask endpoint the docs config advertises
// (`agents.nlweb.enabled` in docs/docs.config.ts) — llms.txt and
// schema-map.xml point here, so the route must exist wherever they deploy.
const handler = createAskHandler({ artifacts: "./public" });

export const Route = createFileRoute("/ask")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
    },
  },
});
