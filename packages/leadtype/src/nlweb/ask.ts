import { type DocsArtifacts, loadDocsArtifacts } from "../mcp/artifacts.js";
import {
  type DocsSearchChunkEntry,
  type DocsSearchContentStore,
  type DocsSearchPosting,
  DocsSearchRequestError,
  type DocsSearchResult,
  readJsonWithLimit,
  searchDocs,
} from "../search/index.js";
import {
  countDocsSearchTerms,
  DOCS_SEARCH_INDEX_VERSION,
  tokenizeDocsSearchText,
} from "../search/search.js";

/** The NLWeb protocol revision the handler's `_meta.version` reports. */
export const NLWEB_PROTOCOL_VERSION = "0.55";

const DEFAULT_RESULT_LIMIT = 10;
const MAX_RESULT_LIMIT = 50;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONTENT_TOO_LARGE = 413;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;
const ALLOWED_METHODS = "GET, POST, OPTIONS";

/**
 * Stable `error.code` values on `/ask` failure responses. Codes are part of the
 * public contract: agents branch on them to decide whether to fix the request,
 * generate artifacts, retry, or stop.
 */
export const NLWEB_ERROR_CODES = {
  /** A non-empty request body that is not parseable JSON. */
  invalidJson: "invalid_json",
  /** Parseable JSON that is not a valid `/ask` request document. */
  invalidRequest: "invalid_request",
  /** A request body larger than the handler's 16 KiB limit. */
  requestTooLarge: "request_too_large",
  /** No query in the URL or the request body. */
  missingQuery: "missing_query",
  /** A method other than `GET`, `POST`, or `OPTIONS`. */
  methodNotAllowed: "method_not_allowed",
  /** The generated docs artifacts the handler reads are not available. */
  artifactsUnavailable: "artifacts_unavailable",
  /** Any other server-side failure; never carries implementation details. */
  internalError: "internal_error",
} as const;

export type NlwebErrorCode =
  (typeof NLWEB_ERROR_CODES)[keyof typeof NLWEB_ERROR_CODES];

/** The `error` object on every `/ask` failure response. */
export type NlwebAskError = {
  code: NlwebErrorCode;
  message: string;
  /** A short recovery hint for the caller. */
  resolution: string;
};

/** One `/ask` result item (NLWeb result shape). */
export type NlwebResult = {
  url: string;
  name: string;
  site: string;
  score: number;
  description: string;
  schema_object: Record<string, unknown>;
};

type NlwebAskMeta<Type extends "answer" | "failure"> = {
  response_type: Type;
  version: string;
  streaming?: boolean;
};

/** A successful (2xx) `/ask` document. */
export type NlwebAskAnswer = {
  query_id: string;
  _meta: NlwebAskMeta<"answer">;
  results: NlwebResult[];
};

/** A non-2xx `/ask` document. `results` is always empty. */
export type NlwebAskFailure = {
  query_id: string;
  _meta: NlwebAskMeta<"failure">;
  error: NlwebAskError;
  results: NlwebResult[];
};

/**
 * Every JSON body `/ask` returns. Narrow with `"error" in body` before reading
 * failure-only fields.
 */
export type NlwebAskResponse = NlwebAskAnswer | NlwebAskFailure;

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
  /**
   * Receives server-side failures before the sanitized response is returned.
   * A returned promise is awaited.
   */
  onError?: (error: unknown) => void | Promise<void>;
};

type ParsedAskRequest = {
  query: string;
  queryId: string;
  streaming: boolean;
};

type AskRequestFailure = {
  error: NlwebAskError;
  status?: number;
  /** The caller's `query_id` when one was readable, so failures correlate. */
  queryId?: string;
};

export const NLWEB_FAILURES: Record<NlwebErrorCode, NlwebAskError> = {
  [NLWEB_ERROR_CODES.invalidJson]: {
    code: NLWEB_ERROR_CODES.invalidJson,
    message: "Request body is not valid JSON.",
    resolution:
      "Send a JSON object body, or omit the body and pass the query in the URL.",
  },
  [NLWEB_ERROR_CODES.invalidRequest]: {
    code: NLWEB_ERROR_CODES.invalidRequest,
    message: "Request body is not a valid /ask request document.",
    resolution:
      'Send {"query": "…"} or {"query": {"text": "…"}}; query_id must be a string.',
  },
  [NLWEB_ERROR_CODES.requestTooLarge]: {
    code: NLWEB_ERROR_CODES.requestTooLarge,
    message: "Request body is too large.",
    resolution: "Keep the JSON request body at or below 16 KiB, then retry.",
  },
  [NLWEB_ERROR_CODES.missingQuery]: {
    code: NLWEB_ERROR_CODES.missingQuery,
    message: "Missing query.",
    resolution: "Pass query in the URL or JSON request body.",
  },
  [NLWEB_ERROR_CODES.methodNotAllowed]: {
    code: NLWEB_ERROR_CODES.methodNotAllowed,
    message: "Method not allowed.",
    resolution: `Use one of: ${ALLOWED_METHODS}.`,
  },
  [NLWEB_ERROR_CODES.artifactsUnavailable]: {
    code: NLWEB_ERROR_CODES.artifactsUnavailable,
    message: "Generated docs artifacts are unavailable.",
    resolution:
      "Generate the docs artifacts on the server (`leadtype generate`), then retry.",
  },
  [NLWEB_ERROR_CODES.internalError]: {
    code: NLWEB_ERROR_CODES.internalError,
    message: "NLWeb request failed.",
    resolution: "Retry the request; check the server logs if it keeps failing.",
  },
};

function metaFor<Type extends "answer" | "failure">(
  responseType: Type,
  streaming?: boolean
): NlwebAskMeta<Type> {
  return {
    response_type: responseType,
    version: NLWEB_PROTOCOL_VERSION,
    ...(streaming === undefined ? {} : { streaming }),
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...headers,
    },
  });
}

function failureResponse(
  error: NlwebAskError,
  status: number,
  options: { queryId?: string; headers?: Record<string, string> } = {}
): Response {
  const body: NlwebAskFailure = {
    query_id: options.queryId ?? crypto.randomUUID(),
    _meta: metaFor("failure"),
    error,
    results: [],
  };
  return jsonResponse(body, status, options.headers);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A supplied `query_id` is echoed back verbatim; blank counts as unsupplied. */
function readQueryId(value: string | null): string | undefined {
  return value?.trim() ? value : undefined;
}

function readBodyQuery(
  body: Record<string, unknown>
): { ok: true; query?: string } | { ok: false } {
  if (!("query" in body)) {
    return { ok: true };
  }
  // Current NLWeb spec shape: `{ query: { text } }`; the original REST shape
  // (and query params) used a flat string. Accept both, reject anything else
  // rather than silently reporting it as a missing query.
  const query = body.query;
  if (typeof query === "string") {
    return { ok: true, query };
  }
  if (isRecord(query) && typeof query.text === "string") {
    return { ok: true, query: query.text };
  }
  return { ok: false };
}

function readBodyQueryId(
  body: Record<string, unknown>
): { ok: true; queryId?: string } | { ok: false } {
  if (!("query_id" in body)) {
    return { ok: true };
  }
  if (typeof body.query_id !== "string") {
    return { ok: false };
  }
  return { ok: true, queryId: readQueryId(body.query_id) };
}

/** Unreadable values are falsy rather than fatal — streaming has a safe default. */
function readBodyStreaming(body: Record<string, unknown>): boolean | undefined {
  const prefer = body.prefer;
  if (isRecord(prefer) && "streaming" in prefer) {
    return isTruthyFlag(prefer.streaming);
  }
  if ("streaming" in body) {
    return isTruthyFlag(body.streaming);
  }
  return;
}

/**
 * Reads a POST body. An empty body is not an error — a POST can carry the whole
 * request in URL params — but a non-empty body must be a JSON object.
 */
async function readJsonBody(
  request: Request
): Promise<
  | { ok: true; body?: Record<string, unknown> }
  | { ok: false; code: NlwebErrorCode }
> {
  if (!request.body) {
    return { ok: true };
  }
  let parsed: unknown;
  try {
    parsed = await readJsonWithLimit(request, { allowEmpty: true });
  } catch (error) {
    if (error instanceof DocsSearchRequestError && error.status === 413) {
      return { ok: false, code: NLWEB_ERROR_CODES.requestTooLarge };
    }
    if (!(error instanceof DocsSearchRequestError)) {
      throw error;
    }
    return { ok: false, code: NLWEB_ERROR_CODES.invalidJson };
  }
  if (parsed === undefined) {
    return { ok: true };
  }
  if (!isRecord(parsed)) {
    return { ok: false, code: NLWEB_ERROR_CODES.invalidRequest };
  }
  return { ok: true, body: parsed };
}

async function parseAskRequest(
  request: Request
): Promise<ParsedAskRequest | AskRequestFailure> {
  const url = new URL(request.url);
  let query =
    url.searchParams.get("query") ?? url.searchParams.get("q") ?? undefined;
  let queryId = readQueryId(url.searchParams.get("query_id"));
  const streamingParam = url.searchParams.get("streaming");
  let streaming: boolean | undefined =
    streamingParam === null ? undefined : isTruthyFlag(streamingParam);

  if (request.method === "POST") {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return {
        error: NLWEB_FAILURES[parsedBody.code],
        queryId,
        ...(parsedBody.code === NLWEB_ERROR_CODES.requestTooLarge
          ? { status: HTTP_CONTENT_TOO_LARGE }
          : {}),
      };
    }
    if (parsedBody.body) {
      const bodyQuery = readBodyQuery(parsedBody.body);
      const bodyQueryId = readBodyQueryId(parsedBody.body);
      if (!(bodyQuery.ok && bodyQueryId.ok)) {
        return {
          error: NLWEB_FAILURES[NLWEB_ERROR_CODES.invalidRequest],
          queryId: bodyQueryId.ok ? (bodyQueryId.queryId ?? queryId) : queryId,
        };
      }
      query = bodyQuery.query ?? query;
      queryId = bodyQueryId.queryId ?? queryId;
      streaming = readBodyStreaming(parsedBody.body) ?? streaming;
    }
  }

  if (!query?.trim()) {
    return {
      error: NLWEB_FAILURES[NLWEB_ERROR_CODES.missingQuery],
      queryId,
    };
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

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isDocumentEntry(value: unknown): boolean {
  if (!(Array.isArray(value) && value.length >= 6 && value.length <= 10)) {
    return false;
  }
  const [
    id,
    title,
    description,
    urlPath,
    absoluteUrl,
    relativePath,
    locale,
    sourceLocale,
    isFallback,
    logicalPath,
  ] = value;
  return (
    [id, title, description, urlPath, absoluteUrl, relativePath].every(
      (field) => typeof field === "string"
    ) &&
    isOptionalString(locale) &&
    isOptionalString(sourceLocale) &&
    (isFallback === undefined ||
      isFallback === null ||
      typeof isFallback === "boolean") &&
    isOptionalString(logicalPath)
  );
}

function isContentStore(value: unknown): value is DocsSearchContentStore {
  return (
    isRecord(value) &&
    value.version === DOCS_SEARCH_INDEX_VERSION &&
    typeof value.generatedAt === "string" &&
    Array.isArray(value.chunks) &&
    value.chunks.every((chunk) => typeof chunk === "string") &&
    Array.isArray(value.codeChunks) &&
    value.codeChunks.length === value.chunks.length &&
    value.codeChunks.every((chunk) => typeof chunk === "string")
  );
}

function isChunkEntry(
  value: unknown,
  documentCount: number,
  contentCount: number | undefined
): value is DocsSearchChunkEntry {
  if (!(Array.isArray(value) && value.length === 6)) {
    return false;
  }
  const [id, documentIndex, anchor, headingPath, length, contentIndex] = value;
  return (
    typeof id === "string" &&
    typeof documentIndex === "number" &&
    Number.isInteger(documentIndex) &&
    documentIndex >= 0 &&
    documentIndex < documentCount &&
    typeof anchor === "string" &&
    Array.isArray(headingPath) &&
    headingPath.every((heading) => typeof heading === "string") &&
    typeof length === "number" &&
    Number.isSafeInteger(length) &&
    length >= 0 &&
    typeof contentIndex === "number" &&
    Number.isInteger(contentIndex) &&
    contentIndex >= 0 &&
    (contentCount === undefined || contentIndex < contentCount)
  );
}

function isPosting(
  value: unknown,
  chunkCount: number
): value is DocsSearchPosting {
  if (!(Array.isArray(value) && value.length === 5)) {
    return false;
  }
  const [chunkIndex, ...weights] = value;
  return (
    typeof chunkIndex === "number" &&
    Number.isInteger(chunkIndex) &&
    chunkIndex >= 0 &&
    chunkIndex < chunkCount &&
    weights.every(
      (weight) =>
        typeof weight === "number" &&
        Number.isSafeInteger(weight) &&
        weight >= 0
    ) &&
    weights.some((weight) => weight > 0)
  );
}

function isPostingList(
  value: unknown,
  chunkCount: number,
  term: string,
  expectedVisiblePostings: Map<
    string,
    Map<number, readonly [number, number, number, number]>
  >
): boolean {
  if (!(Array.isArray(value) && value.length > 0)) {
    return false;
  }
  const chunkIndexes = new Set<number>();
  return value.every((posting) => {
    if (!isPosting(posting, chunkCount)) {
      return false;
    }
    const [chunkIndex, title, heading, body, code] = posting;
    const expectedByChunk = expectedVisiblePostings.get(term);
    const [expectedTitle, expectedHeading, expectedBody, expectedCode] =
      expectedByChunk?.get(chunkIndex) ?? [0, 0, 0, 0];
    if (
      chunkIndexes.has(chunkIndex) ||
      title !== expectedTitle ||
      heading !== expectedHeading ||
      body !== expectedBody ||
      code !== expectedCode
    ) {
      return false;
    }
    if (expectedByChunk?.delete(chunkIndex) && expectedByChunk.size === 0) {
      expectedVisiblePostings.delete(term);
    }
    chunkIndexes.add(chunkIndex);
    return true;
  });
}

function addExpectedVisiblePostings(
  expectedVisiblePostings: Map<
    string,
    Map<number, readonly [number, number, number, number]>
  >,
  chunkIndex: number,
  title: Map<string, number>,
  heading: Map<string, number>,
  body: Map<string, number>,
  code: Map<string, number>
): void {
  const visibleTerms = new Set([
    ...title.keys(),
    ...heading.keys(),
    ...body.keys(),
    ...code.keys(),
  ]);
  for (const term of visibleTerms) {
    const expectedByChunk = expectedVisiblePostings.get(term) ?? new Map();
    expectedByChunk.set(chunkIndex, [
      title.get(term) ?? 0,
      heading.get(term) ?? 0,
      body.get(term) ?? 0,
      code.get(term) ?? 0,
    ]);
    expectedVisiblePostings.set(term, expectedByChunk);
  }
}

function assertNlwebArtifacts(artifacts: DocsArtifacts): void {
  const index = artifacts.index as unknown;
  if (!isRecord(index) || index.version !== DOCS_SEARCH_INDEX_VERSION) {
    throw new Error(
      `leadtype: generated NLWeb search-index.json uses an unsupported version (${String(isRecord(index) ? index.version : "missing")}); run \`leadtype generate\` with this leadtype version and deploy the complete docs output.`
    );
  }
  const manifest = artifacts.manifest as unknown;
  const content = artifacts.content as unknown;
  const embeddedContent = index.content;
  const documents = Array.isArray(index.documents)
    ? index.documents
    : undefined;
  const chunks = Array.isArray(index.chunks) ? index.chunks : undefined;
  const terms = isRecord(index.terms) ? index.terms : null;
  const validContent =
    content === undefined ||
    (isContentStore(content) && content.generatedAt === index.generatedAt);
  const validEmbeddedContent =
    embeddedContent === undefined ||
    (isContentStore(embeddedContent) &&
      embeddedContent.generatedAt === index.generatedAt);
  const selectedContent = content ?? embeddedContent;
  const hasContentStore = selectedContent !== undefined;
  const contentChunks = isContentStore(selectedContent)
    ? selectedContent.chunks
    : undefined;
  const codeChunks = isContentStore(selectedContent)
    ? selectedContent.codeChunks
    : undefined;
  const contentCount = contentChunks?.length;
  const validDocuments = documents?.every(isDocumentEntry) ?? false;
  const chunkIds = new Set<string>();
  const expectedVisiblePostings = new Map<
    string,
    Map<number, readonly [number, number, number, number]>
  >();
  let totalChunkLength = 0;
  const validChunks =
    documents && chunks && contentChunks && codeChunks
      ? chunks.every((chunk, chunkIndex) => {
          if (!isChunkEntry(chunk, documents.length, contentCount)) {
            return false;
          }
          const chunkId = chunk[0];
          const document = documents[chunk[1]];
          const contentIndex = chunk[5];
          const contentText = contentChunks[contentIndex];
          const codeText = codeChunks[contentIndex];
          if (
            !isDocumentEntry(document) ||
            typeof contentText !== "string" ||
            typeof codeText !== "string"
          ) {
            return false;
          }
          const contentTokens = tokenizeDocsSearchText(contentText);
          if (
            chunkIds.has(chunkId) ||
            contentIndex !== chunkIndex ||
            chunk[4] !== contentTokens.length
          ) {
            return false;
          }
          addExpectedVisiblePostings(
            expectedVisiblePostings,
            chunkIndex,
            countDocsSearchTerms(document[1]),
            countDocsSearchTerms(chunk[3].join(" ")),
            countDocsSearchTerms([document[2], contentText].join(" ")),
            countDocsSearchTerms(codeText)
          );
          chunkIds.add(chunkId);
          totalChunkLength += chunk[4];
          return true;
        })
      : false;
  const expectedAverageChunkLength = chunks?.length
    ? totalChunkLength / chunks.length
    : 0;
  const averageChunkLengthTolerance =
    Number.EPSILON * Math.max(1, expectedAverageChunkLength);
  const validTerms =
    terms && chunks
      ? Object.entries(terms).every(([term, postings]) =>
          isPostingList(postings, chunks.length, term, expectedVisiblePostings)
        ) && expectedVisiblePostings.size === 0
      : false;
  const validIndex =
    typeof index.generatedAt === "string" &&
    validDocuments &&
    validChunks &&
    validTerms &&
    typeof index.averageChunkLength === "number" &&
    Number.isFinite(index.averageChunkLength) &&
    index.averageChunkLength >= 0 &&
    Math.abs(index.averageChunkLength - expectedAverageChunkLength) <=
      averageChunkLengthTolerance;
  const validManifest =
    isRecord(manifest) &&
    typeof manifest.generatedAt === "string" &&
    typeof manifest.baseUrl === "string" &&
    isRecord(manifest.product) &&
    typeof manifest.product.name === "string" &&
    Array.isArray(manifest.pages);

  if (!hasContentStore) {
    throw new Error(
      "leadtype: generated NLWeb artifacts are missing search content (search-index.json has no embedded content and search-content.json is unavailable). Run `leadtype generate` and deploy the complete docs output."
    );
  }

  if (!(validIndex && validManifest && validContent && validEmbeddedContent)) {
    throw new Error(
      "leadtype: generated NLWeb artifacts have an invalid shape."
    );
  }
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
 *
 * Every failure answers with the NLWeb failure envelope — a stable
 * `error.code` (see `NLWEB_ERROR_CODES`), a message, and a `resolution` the
 * caller can act on — except the bodyless 204 answer to `OPTIONS`. Failures are
 * always JSON, even when the request asked for streaming.
 */
export function createAskHandler(
  config: CreateAskHandlerConfig = {}
): (request: Request) => Promise<Response> {
  const loadArtifacts = async (): Promise<DocsArtifacts> => {
    const artifacts = await loadDocsArtifacts({ artifacts: config.artifacts });
    assertNlwebArtifacts(artifacts);
    return artifacts;
  };
  let artifactsPromise: Promise<DocsArtifacts> | null = null;
  const getArtifacts = (): Promise<DocsArtifacts> => {
    artifactsPromise ??= loadArtifacts();
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
          "access-control-allow-methods": ALLOWED_METHODS,
          "access-control-allow-headers": "content-type, accept",
        },
      });
    }
    if (request.method !== "GET" && request.method !== "POST") {
      const queryId = readQueryId(
        new URL(request.url).searchParams.get("query_id")
      );
      return failureResponse(
        NLWEB_FAILURES[NLWEB_ERROR_CODES.methodNotAllowed],
        HTTP_METHOD_NOT_ALLOWED,
        { headers: { allow: ALLOWED_METHODS }, queryId }
      );
    }

    let queryId = readQueryId(
      new URL(request.url).searchParams.get("query_id")
    );
    let failureCode: NlwebErrorCode = NLWEB_ERROR_CODES.internalError;
    try {
      const parsed = await parseAskRequest(request);
      if ("error" in parsed) {
        return failureResponse(
          parsed.error,
          parsed.status ?? HTTP_BAD_REQUEST,
          {
            queryId: parsed.queryId,
          }
        );
      }
      queryId = parsed.queryId;
      failureCode = NLWEB_ERROR_CODES.artifactsUnavailable;

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
      failureCode = NLWEB_ERROR_CODES.internalError;

      if (parsed.streaming) {
        return streamResponse(parsed, results);
      }
      const body: NlwebAskAnswer = {
        query_id: parsed.queryId,
        _meta: metaFor("answer"),
        results,
      };
      return jsonResponse(body);
    } catch (error) {
      // The artifacts-missing error names local directories, so the response
      // only carries the code and generic setup guidance; everything else stays
      // generic too, so internals never leak into the response body.
      const failure = NLWEB_FAILURES[failureCode];
      try {
        await config.onError?.(error);
      } catch {
        // Observability must not replace the stable failure response.
      }
      return failureResponse(failure, HTTP_INTERNAL_ERROR, { queryId });
    }
  };
}
