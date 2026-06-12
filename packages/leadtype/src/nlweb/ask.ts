import {
  type DocsArtifacts,
  loadDocsArtifacts,
  MissingDocsArtifactsError,
} from "../mcp/artifacts.js";
import { type DocsSearchResult, searchDocs } from "../search/index.js";

/** The NLWeb protocol revision the handler's `_meta.version` reports. */
export const NLWEB_PROTOCOL_VERSION = "0.55";

const DEFAULT_RESULT_LIMIT = 10;
const MAX_RESULT_LIMIT = 50;
const HTTP_BAD_REQUEST = 400;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;

/** One `/ask` result item (NLWeb result shape). */
export type NlwebResult = {
  url: string;
  name: string;
  site: string;
  score: number;
  description: string;
  schema_object: Record<string, unknown>;
};

export type NlwebAskResponse = {
  query_id: string;
  _meta: {
    response_type: "answer" | "failure";
    version: string;
    streaming?: boolean;
  };
  /** Present on `failure` responses. */
  error?: { message: string };
  results: NlwebResult[];
};

export type CreateAskHandlerConfig = {
  /**
   * Directory containing the generated `docs/` folder (read from disk at request
   * time). Defaults to `./public`.
   */
  artifacts?: string;
  /**
   * The `site` token echoed on every result. Defaults to the host of the
   * generated `baseUrl`, falling back to the product name.
   */
  site?: string;
  /** Max results per query. Defaults to 10, capped at 50. */
  limit?: number;
};

type ParsedAskRequest = {
  query: string;
  queryId: string;
  streaming: boolean;
};

function metaFor(
  responseType: NlwebAskResponse["_meta"]["response_type"],
  streaming?: boolean
): NlwebAskResponse["_meta"] {
  return {
    response_type: responseType,
    version: NLWEB_PROTOCOL_VERSION,
    ...(streaming === undefined ? {} : { streaming }),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function failureResponse(message: string, status: number): Response {
  const body: NlwebAskResponse = {
    query_id: crypto.randomUUID(),
    _meta: metaFor("failure"),
    error: { message },
    results: [],
  };
  return jsonResponse(body, status);
}

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return !["", "0", "false", "no"].includes(value.toLowerCase());
  }
  return false;
}

function readBodyQuery(body: Record<string, unknown>): string | undefined {
  // Current NLWeb spec shape: `{ query: { text } }`; the original REST shape
  // (and query params) used a flat string. Accept both.
  const query = body.query;
  if (typeof query === "string") {
    return query;
  }
  if (query && typeof query === "object" && "text" in query) {
    const text = (query as { text?: unknown }).text;
    return typeof text === "string" ? text : undefined;
  }
  return;
}

function readBodyStreaming(body: Record<string, unknown>): boolean | undefined {
  const prefer = body.prefer;
  if (prefer && typeof prefer === "object" && "streaming" in prefer) {
    return isTruthyFlag((prefer as { streaming?: unknown }).streaming);
  }
  if ("streaming" in body) {
    return isTruthyFlag(body.streaming);
  }
  return;
}

async function parseAskRequest(
  request: Request
): Promise<ParsedAskRequest | { error: string }> {
  const url = new URL(request.url);
  let query =
    url.searchParams.get("query") ?? url.searchParams.get("q") ?? undefined;
  let queryId = url.searchParams.get("query_id") ?? undefined;
  const streamingParam = url.searchParams.get("streaming");
  let streaming: boolean | undefined =
    streamingParam === null ? undefined : isTruthyFlag(streamingParam);

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      // A POST without a JSON body can still carry everything as params.
      body = undefined;
    }
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      query = readBodyQuery(record) ?? query;
      streaming = readBodyStreaming(record) ?? streaming;
      if (typeof record.query_id === "string") {
        queryId = record.query_id;
      }
    }
  }

  if (!query?.trim()) {
    return { error: "Missing query. Pass ?query= or a JSON body with query." };
  }

  // NLWeb defaults to streaming; we only stream when asked for (explicit
  // `streaming`/`prefer.streaming`, or an SSE Accept header) so that plain
  // fetches and scanners get the JSON document they expect.
  const acceptsSse = (request.headers.get("accept") ?? "").includes(
    "text/event-stream"
  );
  return {
    query: query.trim(),
    queryId: queryId ?? crypto.randomUUID(),
    streaming: streaming ?? acceptsSse,
  };
}

function resolveSite(
  config: CreateAskHandlerConfig,
  artifacts: DocsArtifacts
): string {
  if (config.site) {
    return config.site;
  }
  try {
    return new URL(artifacts.manifest.baseUrl).host;
  } catch {
    return artifacts.manifest.product.name;
  }
}

function toNlwebResult(
  result: DocsSearchResult,
  site: string,
  productName: string
): NlwebResult {
  const description = result.description || result.excerpt;
  return {
    url: result.absoluteUrl,
    name: result.title,
    site,
    score: result.score,
    description,
    schema_object: {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      url: result.absoluteUrl,
      name: result.title,
      description,
      isPartOf: {
        "@type": "WebSite",
        name: productName,
      },
    },
  };
}

/** Search hits are heading-level; keep the best hit per page. */
function dedupeByPage(results: DocsSearchResult[]): DocsSearchResult[] {
  const seen = new Set<string>();
  const deduped: DocsSearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.urlPath)) {
      continue;
    }
    seen.add(result.urlPath);
    deduped.push(result);
  }
  return deduped;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(
  parsed: ParsedAskRequest,
  results: NlwebResult[]
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          sseEvent("start", {
            query_id: parsed.queryId,
            _meta: metaFor("answer", true),
          })
        )
      );
      for (const [index, item] of results.entries()) {
        controller.enqueue(encoder.encode(sseEvent("result", { index, item })));
      }
      controller.enqueue(
        encoder.encode(
          sseEvent("complete", {
            query_id: parsed.queryId,
            _meta: metaFor("answer"),
          })
        )
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    },
  });
}

/**
 * Creates a Web-standard handler for an NLWeb `/ask` endpoint over the
 * generated docs artifacts — list mode backed by the same search index the
 * docs MCP server uses, no LLM required:
 *
 * ```ts
 * // app/ask/route.ts (Next App Router)
 * import { createAskHandler } from "leadtype/nlweb";
 * const handler = createAskHandler({ artifacts: "./public" });
 * export const GET = handler;
 * export const POST = handler;
 * ```
 *
 * Accepts the NLWeb request shapes (`?query=` params, flat JSON, or the
 * `{ query: { text }, prefer: { streaming } }` document) and answers with
 * `{ query_id, _meta, results }` — or SSE `start`/`result`/`complete` events
 * when streaming is requested.
 */
export function createAskHandler(
  config: CreateAskHandlerConfig = {}
): (request: Request) => Promise<Response> {
  let artifactsPromise: Promise<DocsArtifacts> | null = null;
  const getArtifacts = (): Promise<DocsArtifacts> => {
    artifactsPromise ??= loadDocsArtifacts({ artifacts: config.artifacts });
    return artifactsPromise;
  };
  const requestedLimit = config.limit ?? DEFAULT_RESULT_LIMIT;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_RESULT_LIMIT)
    : DEFAULT_RESULT_LIMIT;

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, accept",
        },
      });
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response(null, {
        status: HTTP_METHOD_NOT_ALLOWED,
        headers: { allow: "GET, POST, OPTIONS" },
      });
    }

    try {
      const parsed = await parseAskRequest(request);
      if ("error" in parsed) {
        return failureResponse(parsed.error, HTTP_BAD_REQUEST);
      }

      let artifacts: DocsArtifacts;
      try {
        artifacts = await getArtifacts();
      } catch (error) {
        // Reset so a transient failure (e.g. artifacts not generated yet) retries.
        artifactsPromise = null;
        throw error;
      }

      const site = resolveSite(config, artifacts);
      const productName = artifacts.manifest.product.name;
      const hits = dedupeByPage(
        searchDocs(artifacts.index, parsed.query, {
          limit,
          content: artifacts.content,
        })
      );
      const results = hits.map((hit) => toNlwebResult(hit, site, productName));

      if (parsed.streaming) {
        return streamResponse(parsed, results);
      }
      const body: NlwebAskResponse = {
        query_id: parsed.queryId,
        _meta: metaFor("answer"),
        results,
      };
      return jsonResponse(body);
    } catch (error) {
      // The artifacts-missing message is actionable setup guidance; everything
      // else stays generic so internals never leak into the response body.
      const message =
        error instanceof MissingDocsArtifactsError
          ? error.message
          : "NLWeb request failed.";
      return failureResponse(message, HTTP_INTERNAL_ERROR);
    }
  };
}
