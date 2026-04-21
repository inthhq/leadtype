import {
  DocsSearchRequestError,
  docsSearchDefaults,
  getClientIdentifier,
  searchDocs,
  validateDocsQuery,
} from "@inth/docs/search";
import { createFileRoute } from "@tanstack/react-router";
import {
  docsSearchIndex,
  docsSearchLimiters,
  jsonResponse,
} from "@/lib/search";

export const Route = createFileRoute("/api/docs/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const query = validateDocsQuery(url.searchParams.get("q") ?? "", {
            maxChars: docsSearchDefaults.maxQueryChars,
          });
          const rateLimit = await docsSearchLimiters.search.check(
            `search:${getClientIdentifier(request)}`
          );

          if (!rateLimit.allowed) {
            return jsonResponse(
              { error: "Too many search requests. Try again shortly." },
              {
                status: 429,
                headers: {
                  "Retry-After": Math.ceil(
                    (rateLimit.resetAt - Date.now()) / 1000
                  ).toString(),
                },
              }
            );
          }

          return jsonResponse({
            results: searchDocs(docsSearchIndex, query),
          });
        } catch (error) {
          if (error instanceof DocsSearchRequestError) {
            return jsonResponse(
              { error: error.message },
              { status: error.status }
            );
          }
          return jsonResponse({ error: "Search failed." }, { status: 500 });
        }
      },
    },
  },
});
