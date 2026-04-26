import {
  DocsSearchRequestError,
  docsSearchDefaults,
  getClientIdentifier,
  readJsonWithLimit,
  validateDocsQuery,
} from "@inth/docs/search";
import { streamDocsAnswer } from "@inth/docs/search/vercel";
import { createFileRoute } from "@tanstack/react-router";
import {
  docsSearchContent,
  docsSearchIndex,
  docsSearchLimiters,
  isAiAnswerEnabled,
  jsonResponse,
} from "@/lib/search";

const DEFAULT_MODEL = "openai/gpt-5.4-mini";
const DEFAULT_MAX_OUTPUT_TOKENS = 2000;
const DEFAULT_TIMEOUT = {
  chunkMs: 15_000,
  totalMs: 45_000,
} as const;

export const Route = createFileRoute("/api/docs/ask")({
  server: {
    handlers: {
      GET: async () =>
        jsonResponse({
          enabled: isAiAnswerEnabled(),
          model: process.env.DOCS_SEARCH_MODEL ?? DEFAULT_MODEL,
        }),
      POST: async ({ request }) => {
        try {
          if (!isAiAnswerEnabled()) {
            return jsonResponse(
              {
                error:
                  "AI answers are disabled. Set AI_GATEWAY_API_KEY locally or deploy with Vercel AI Gateway.",
              },
              { status: 503 }
            );
          }

          const rateLimit = await docsSearchLimiters.ask.check(
            `ask:${getClientIdentifier(request)}`
          );

          if (!rateLimit.allowed) {
            return jsonResponse(
              { error: "Too many answer requests. Try again shortly." },
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

          const body = await readJsonWithLimit<{ query?: unknown }>(request, {
            maxBytes: docsSearchDefaults.maxBodyBytes,
          });
          const query = validateDocsQuery(body.query, {
            fieldName: "query",
            maxChars: docsSearchDefaults.askMaxQueryChars,
          });

          return streamDocsAnswer({
            index: docsSearchIndex,
            content: docsSearchContent,
            query,
            model: process.env.DOCS_SEARCH_MODEL ?? DEFAULT_MODEL,
            maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
            productName: "@inth/docs",
            timeout: DEFAULT_TIMEOUT,
          }).response;
        } catch (error) {
          if (error instanceof DocsSearchRequestError) {
            return jsonResponse(
              { error: error.message },
              { status: error.status }
            );
          }
          return jsonResponse(
            { error: "Answer generation failed." },
            { status: 500 }
          );
        }
      },
    },
  },
});
