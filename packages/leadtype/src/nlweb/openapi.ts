import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../internal/atomic-fs.js";
import { normalizeBaseUrl } from "../internal/docs-url.js";
import type { LlmsProductInfo } from "../llm/llm.js";
import type { ApiCatalogEntry } from "../llm/readability.js";
import {
  NLWEB_ERROR_CODES,
  NLWEB_FAILURES,
  NLWEB_PROTOCOL_VERSION,
  type NlwebErrorCode,
} from "./ask.js";
import {
  DEFAULT_NLWEB_ASK_PATH,
  NLWEB_ALLOWED_METHODS,
  NLWEB_ALLOWED_REQUEST_HEADERS,
  NLWEB_SCHEMA_FEED_PATH,
  NLWEB_SCHEMA_MAP_PATH,
} from "./paths.js";

/** OpenAPI revision the generated document declares. */
export const NLWEB_OPENAPI_VERSION = "3.1.1";

/** Public URL path the document is served at unless configured otherwise. */
export const DEFAULT_NLWEB_OPENAPI_URL_PATH = "/openapi.json";

/** Output path, relative to the generate `outDir`, unless configured otherwise. */
export const DEFAULT_NLWEB_OPENAPI_OUTPUT_PATH = "openapi.json";

/** Media type an RFC 9727 `service-desc` link uses for this document. */
export const NLWEB_OPENAPI_MEDIA_TYPE =
  "application/vnd.oai.openapi+json;version=3.1";

/** Title the generated catalog member carries. */
export const NLWEB_API_CATALOG_TITLE = "Documentation query API";

const NLWEB_OPENAPI_OWNERSHIP_EXTENSION = "x-leadtype-generated";
const NLWEB_OPENAPI_OWNERSHIP_VERSION = 1;

const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const PARENT_URL_SEGMENT_PATTERN = /(?:^|\/)(?:%2e|\.)(?:%2e|\.)(?:\/|$)/i;
const CURRENT_URL_SEGMENT_PATTERN = /(?:^|\/)(?:%2e|\.)(?:\/|$)/i;
const INVALID_PERCENT_ESCAPE_PATTERN = /%(?![0-9a-f]{2})/i;
const PERCENT_ESCAPE_PATTERN = /%[0-9a-f]{2}/i;
const ASCII_CONTROL_MAX_CODE_POINT = 0x1f;
const ASCII_DELETE_CODE_POINT = 0x7f;
const WINDOWS_DRIVE_PATTERN = /^[a-z]:/i;
const WINDOWS_RESERVED_DEVICE_SEGMENT_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const JSON_MEDIA_TYPE = "application/json";
const SSE_MEDIA_TYPE = "text/event-stream";
const JSON_INDENT = 2;

/**
 * Files `leadtype generate` already writes into the output root. Emitting the
 * OpenAPI document over one of them would silently destroy another surface, so
 * a colliding `output` fails at config load instead.
 */
const RESERVED_OUTPUT_FILES = new Set([
  ".well-known/agent-card.json",
  ".well-known/api-catalog",
  ".well-known/llms-full.txt",
  ".well-known/llms.txt",
  ".well-known/mcp.json",
  ".well-known/mcp/server-card.json",
  "agent-readability.json",
  "agents.md",
  "llms-full.txt",
  "llms.txt",
  "mcp.json",
  "robots.txt",
  "sitemap.md",
  "sitemap.xml",
  NLWEB_SCHEMA_FEED_PATH,
  NLWEB_SCHEMA_MAP_PATH,
]);

/**
 * Directories generate owns wholesale: `docs/` is the markdown mirror plus the
 * search and readability artifacts, `feeds/` is the feed generator's output.
 */
const RESERVED_OUTPUT_DIRECTORIES = [
  ".well-known/agent-skills",
  "docs",
  "feeds",
];

/** OpenAPI description of the `/ask` endpoint. */
export type NlwebOpenApiConfig = {
  /** Emit the document. Defaults to `true` whenever NLWeb is enabled. */
  enabled?: boolean;
  /**
   * Public URL the document is served at — a root-relative path
   * (`/openapi.json`) or an absolute URL. Defaults to `/openapi.json`, and
   * supplies the default `output` when that is unset.
   */
  url?: string;
  /**
   * Output path, relative to the generate output root. Defaults to the `url`
   * path without its leading slash. Must be a relative `.json` path inside the
   * output root that no other generated artifact already owns.
   */
  output?: string;
};

/** The resolved, validated OpenAPI emission target. */
export type ResolvedNlwebOpenApi = {
  /** Public URL path (or absolute URL) the document is served at. */
  url: string;
  /** Output path relative to the generate output root, POSIX-separated. */
  output: string;
};

/** Where the `/ask` endpoint lives, split for an OpenAPI document. */
export type AskEndpointLocation = {
  /** The `paths` key, always rooted at `/`. */
  pathKey: string;
  /** Origin (or base URL) the path is relative to, when one is known. */
  serverUrl?: string;
};

export type BuildAskOpenApiDocumentConfig = {
  /** Names the API and its `info.title`. */
  product: LlmsProductInfo;
  /** Site base URL. Becomes the server when the endpoint is a bare path. */
  baseUrl?: string;
  /** The `/ask` endpoint path or absolute URL, as authored. Defaults to `/ask`. */
  askEndpoint?: string;
  /** `info.version`. Defaults to the NLWeb protocol revision the handler reports. */
  version?: string;
  /** Human-readable API documentation, linked as `externalDocs`. */
  docsUrl?: string;
};

export type AskOpenApiDocument = {
  openapi: string;
  info: Record<string, unknown>;
  servers?: { url: string; description?: string }[];
  externalDocs?: Record<string, unknown>;
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, Record<string, unknown>>;
  /** Self-verifying ownership metadata for builds without writable state. */
  "x-leadtype-generated"?: {
    generator: "leadtype";
    version: typeof NLWEB_OPENAPI_OWNERSHIP_VERSION;
    contentSha256: string;
  };
};

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

function withOpenApiOwnershipMarker(
  document: AskOpenApiDocument
): AskOpenApiDocument {
  return {
    ...document,
    [NLWEB_OPENAPI_OWNERSHIP_EXTENSION]: {
      generator: "leadtype",
      version: NLWEB_OPENAPI_OWNERSHIP_VERSION,
      contentSha256: sha256(renderJson(document)),
    },
  };
}

/** Verify the self-contained ownership marker on a rendered NLWeb document. */
export function hasValidAskOpenApiOwnershipMarker(
  contents: string | Uint8Array
): boolean {
  try {
    const source =
      typeof contents === "string"
        ? contents
        : new TextDecoder("utf-8", { fatal: true }).decode(contents);
    const parsed = JSON.parse(source) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    if (renderJson(record) !== source) {
      return false;
    }
    const marker = record[NLWEB_OPENAPI_OWNERSHIP_EXTENSION];
    if (
      typeof marker !== "object" ||
      marker === null ||
      !("generator" in marker) ||
      marker.generator !== "leadtype" ||
      !("version" in marker) ||
      marker.version !== NLWEB_OPENAPI_OWNERSHIP_VERSION ||
      !("contentSha256" in marker) ||
      typeof marker.contentSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(marker.contentSha256) ||
      Object.keys(marker).length !== 3
    ) {
      return false;
    }
    const { [NLWEB_OPENAPI_OWNERSHIP_EXTENSION]: _, ...document } = record;
    return sha256(renderJson(document)) === marker.contentSha256;
  } catch {
    return false;
  }
}

function toPosix(value: string): string {
  return value.split("\\").join("/");
}

function configError(message: string, field: string): Error {
  return new Error(`${field} ${message}`);
}

function hasAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= ASCII_CONTROL_MAX_CODE_POINT ||
      codePoint === ASCII_DELETE_CODE_POINT
    ) {
      return true;
    }
  }
  return false;
}

/** Validate an authored NLWeb endpoint at config and direct API boundaries. */
export function assertSafeNlwebAskEndpoint(
  value: string,
  field = "askEndpoint"
): string {
  if (hasAsciiControlCharacter(value)) {
    throw configError("must not contain ASCII control characters", field);
  }
  if (value.includes("\\")) {
    throw configError("must not contain backslashes", field);
  }
  const endpoint = value.trim();
  if (!endpoint) {
    throw configError("must not be empty", field);
  }
  if (endpoint !== value) {
    throw configError("must not contain surrounding whitespace", field);
  }
  if (/[?#]/.test(endpoint)) {
    throw configError("must not contain a query string or fragment", field);
  }
  if (endpoint.startsWith("//")) {
    throw configError("must not be protocol-relative", field);
  }
  const isHttpUrl = ABSOLUTE_URL_PATTERN.test(endpoint);
  if (URI_SCHEME_PATTERN.test(endpoint) && !isHttpUrl) {
    throw configError("must be an HTTP(S) URL or path", field);
  }
  if (isHttpUrl) {
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw configError("must be a valid absolute URL", field);
    }
    if (parsed.username || parsed.password) {
      throw configError("must not include a username or password", field);
    }
  }
  if (INVALID_PERCENT_ESCAPE_PATTERN.test(value)) {
    throw configError("must not contain a malformed percent escape", field);
  }
  if (!isHttpUrl && PARENT_URL_SEGMENT_PATTERN.test(endpoint)) {
    throw configError('must not contain ".." path segments', field);
  }
  return endpoint;
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function nearestExistingRealPath(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `leadtype: could not resolve an existing ancestor for "${candidate}".`
      );
    }
    current = parent;
  }
}

/** Reject output paths whose existing parent chain escapes through a symlink. */
export async function assertNlwebOutputPathInsideRoot(
  outDir: string,
  outputPath: string
): Promise<void> {
  const root = path.resolve(outDir);
  const target = path.resolve(outputPath);
  const lexicalRelative = path.relative(root, target);
  if (
    lexicalRelative.startsWith(`..${path.sep}`) ||
    lexicalRelative === ".." ||
    path.isAbsolute(lexicalRelative)
  ) {
    throw new Error(
      `leadtype: NLWeb OpenAPI output must stay inside the output root ("${target}").`
    );
  }
  let physicalRoot: string;
  try {
    physicalRoot = await realpath(root);
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }
    throw error;
  }
  const physicalParent = await nearestExistingRealPath(path.dirname(target));
  const physicalRelative = path.relative(physicalRoot, physicalParent);
  if (
    physicalRelative.startsWith(`..${path.sep}`) ||
    physicalRelative === ".." ||
    path.isAbsolute(physicalRelative)
  ) {
    throw new Error(
      `leadtype: NLWeb OpenAPI output resolves outside the physical output root ("${target}").`
    );
  }
}

/**
 * Validate an authored output path. Traversal, absolute paths, and paths that
 * land on another generated artifact are rejected here — at config load — so a
 * broken value never reaches a build that would overwrite a live surface.
 */
export function assertSafeNlwebOpenApiOutput(
  output: string,
  field = "agents.nlweb.openapi.output"
): string {
  if (hasAsciiControlCharacter(output)) {
    throw configError(
      `must not contain ASCII control characters ("${output}")`,
      field
    );
  }
  const trimmed = toPosix(output.trim());
  if (!trimmed) {
    throw configError("must not be empty", field);
  }
  if (
    trimmed.startsWith("/") ||
    WINDOWS_DRIVE_PATTERN.test(trimmed) ||
    path.isAbsolute(trimmed)
  ) {
    throw configError(
      `must be relative to the output directory, not an absolute path ("${output}")`,
      field
    );
  }
  if (/[?#]/.test(trimmed)) {
    throw configError(
      `must not contain "?" or "#" URL delimiters ("${output}")`,
      field
    );
  }
  if (INVALID_PERCENT_ESCAPE_PATTERN.test(trimmed)) {
    throw configError(
      `must not contain a malformed percent escape ("${output}")`,
      field
    );
  }
  if (PERCENT_ESCAPE_PATTERN.test(trimmed)) {
    throw configError(
      `must not contain percent escapes; use decoded filesystem characters or configure url separately ("${output}")`,
      field
    );
  }
  const segments = trimmed.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw configError(
      `must not contain "." or ".." segments, or empty segments ("${output}")`,
      field
    );
  }
  const reservedDeviceSegment = segments.find((segment) =>
    WINDOWS_RESERVED_DEVICE_SEGMENT_PATTERN.test(segment)
  );
  if (reservedDeviceSegment) {
    throw configError(
      `must not contain the Windows reserved device-name segment "${reservedDeviceSegment}" ("${output}")`,
      field
    );
  }
  // Collisions are checked before the extension, so a path that lands on
  // another artifact says so rather than complaining about its suffix.
  const lower = trimmed.toLowerCase();
  if (RESERVED_OUTPUT_FILES.has(lower)) {
    throw configError(
      `would overwrite the generated "${trimmed}" artifact; pick another path`,
      field
    );
  }
  const reservedFile = [...RESERVED_OUTPUT_FILES].find((file) =>
    lower.startsWith(`${file}/`)
  );
  if (reservedFile) {
    throw configError(
      `must not write beneath the generated "${reservedFile}" file ("${trimmed}")`,
      field
    );
  }
  const reservedDir = RESERVED_OUTPUT_DIRECTORIES.find((dir) =>
    lower.startsWith(`${dir}/`)
  );
  if (reservedDir) {
    throw configError(
      `must not write into the generated "${reservedDir}/" directory ("${trimmed}")`,
      field
    );
  }
  if (!lower.endsWith(".json")) {
    throw configError(
      `must end in ".json" — the generated document is JSON ("${output}")`,
      field
    );
  }
  return trimmed;
}

function assertSafeNlwebOpenApiUrl(url: string, field: string): string {
  if (hasAsciiControlCharacter(url)) {
    throw configError(
      `must not contain ASCII control characters ("${url}")`,
      field
    );
  }
  if (url.includes("\\")) {
    throw configError(`must not contain backslashes ("${url}")`, field);
  }
  const trimmed = url.trim();
  if (!trimmed) {
    throw configError("must not be empty", field);
  }
  if (trimmed.startsWith("//")) {
    throw configError(
      `must not be protocol-relative; use a root-relative path or an absolute URL ("${url}")`,
      field
    );
  }
  if (INVALID_PERCENT_ESCAPE_PATTERN.test(trimmed)) {
    throw configError(
      `must not contain a malformed percent escape ("${url}")`,
      field
    );
  }
  const [pathname] = trimmed.split(/[?#]/, 1);
  if (PARENT_URL_SEGMENT_PATTERN.test(pathname ?? "")) {
    throw configError(
      `must not contain ".." segments, including percent-encoded segments ("${url}")`,
      field
    );
  }
  if (CURRENT_URL_SEGMENT_PATTERN.test(pathname ?? "")) {
    throw configError(
      `must not contain "." segments, including percent-encoded segments ("${url}")`,
      field
    );
  }
  if (ABSOLUTE_URL_PATTERN.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw configError(`must be a valid absolute URL ("${url}")`, field);
    }
    if (parsed.username || parsed.password) {
      throw configError(
        `must not include a username or password ("${url}")`,
        field
      );
    }
    return trimmed;
  }
  if (!trimmed.startsWith("/")) {
    throw configError(
      `must be a root-relative path starting with "/" or an absolute URL ("${url}")`,
      field
    );
  }
  return trimmed;
}

/** The output path a public URL implies: its pathname, without the leading slash. */
function outputFromUrl(url: string, field: string): string {
  const [authoredPath = ""] = url.split(/[?#]/, 1);
  const pathname = ABSOLUTE_URL_PATTERN.test(authoredPath)
    ? new URL(authoredPath).pathname
    : authoredPath;
  const encodedRelative = pathname.replace(/^\/+/, "");
  if (!encodedRelative) {
    throw configError(
      `does not name a file, so it cannot supply a default output path — set agents.nlweb.openapi.output ("${url}")`,
      field
    );
  }
  const decodedSegments = encodedRelative.split("/").map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw configError(
        `must contain only valid UTF-8 percent escapes ("${url}")`,
        field
      );
    }
    if (decoded.includes("/") || decoded.includes("\\")) {
      throw configError(
        `must not contain percent-encoded path separators ("${url}")`,
        field
      );
    }
    if (hasAsciiControlCharacter(decoded)) {
      throw configError(
        `must not contain percent-encoded ASCII control characters ("${url}")`,
        field
      );
    }
    return decoded;
  });
  const relative = decodedSegments.join("/");
  return assertSafeNlwebOpenApiOutput(relative, field);
}

/**
 * Resolve the OpenAPI emission target. Returns `null` when the document is
 * turned off. `url` and `output` default from each other so a site that moves
 * one moves both, and both are validated before a build can use them.
 */
export function resolveNlwebOpenApiConfig(
  config: NlwebOpenApiConfig | undefined,
  field = "agents.nlweb.openapi"
): ResolvedNlwebOpenApi | null {
  if (config?.enabled === false) {
    return null;
  }
  const authoredOutput =
    config?.output === undefined
      ? undefined
      : assertSafeNlwebOpenApiOutput(config.output, `${field}.output`);
  let url = DEFAULT_NLWEB_OPENAPI_URL_PATH;
  if (config?.url !== undefined) {
    url = assertSafeNlwebOpenApiUrl(config.url, `${field}.url`);
  } else if (authoredOutput) {
    url = assertSafeNlwebOpenApiUrl(`/${authoredOutput}`, `${field}.output`);
  }
  if (authoredOutput) {
    return { url, output: authoredOutput };
  }
  // No authored output: derive it from the public URL, so `/api/openapi.json`
  // is emitted at `api/openapi.json` without a second setting.
  const resolvedOutput =
    config?.url === undefined
      ? DEFAULT_NLWEB_OPENAPI_OUTPUT_PATH
      : outputFromUrl(url, `${field}.url`);
  return { url, output: resolvedOutput };
}

/**
 * Split the `/ask` endpoint into an OpenAPI server and a `paths` key. An
 * absolute endpoint contributes its origin as the server and its pathname as
 * the key, so a cross-origin `/ask` is described honestly rather than being
 * flattened into a path on the docs site.
 */
export function resolveAskEndpointLocation(
  askEndpoint?: string,
  baseUrl?: string
): AskEndpointLocation {
  const endpoint =
    askEndpoint === undefined
      ? DEFAULT_NLWEB_ASK_PATH
      : assertSafeNlwebAskEndpoint(askEndpoint);
  if (ABSOLUTE_URL_PATTERN.test(endpoint)) {
    const parsed = new URL(endpoint);
    const pathKey = parsed.pathname || "/";
    return { pathKey, serverUrl: parsed.origin };
  }
  const parsed = new URL(endpoint, "https://leadtype.invalid/");
  const pathKey = parsed.pathname || "/";
  const server = baseUrl?.trim() ? normalizeBaseUrl(baseUrl) : undefined;
  return { pathKey, ...(server ? { serverUrl: server } : {}) };
}

const ERROR_CODES = Object.values(NLWEB_ERROR_CODES);

const CORS_ORIGIN_HEADER = {
  description:
    "Always `*`: the endpoint is public and answers cross-origin browser requests.",
  schema: { type: "string", const: "*" },
} as const;

function failureResponse(
  description: string,
  codes: NlwebErrorCode[],
  headers: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    description,
    headers: {
      "Access-Control-Allow-Origin": CORS_ORIGIN_HEADER,
      ...headers,
    },
    content: {
      [JSON_MEDIA_TYPE]: {
        schema: { $ref: "#/components/schemas/AskFailure" },
        examples: Object.fromEntries(
          codes.map((code) => [
            code,
            {
              summary: code,
              value: {
                query_id: "01JF0000000000000000000000",
                _meta: {
                  response_type: "failure",
                  version: NLWEB_PROTOCOL_VERSION,
                },
                error: NLWEB_FAILURES[code],
                results: [],
              },
            },
          ])
        ),
      },
    },
  };
}

const SSE_EXAMPLE = [
  `event: start\ndata: {"query_id":"01JF0000000000000000000000","_meta":{"response_type":"answer","version":"${NLWEB_PROTOCOL_VERSION}","streaming":true}}`,
  'event: result\ndata: {"index":0,"item":{"url":"https://example.com/docs/quickstart","name":"Quickstart","site":"example.com","score":12.4,"description":"Install and configure the package.","schema_object":{"@type":"TechArticle"}}}',
  `event: complete\ndata: {"query_id":"01JF0000000000000000000000","_meta":{"response_type":"answer","version":"${NLWEB_PROTOCOL_VERSION}"}}`,
  "",
].join("\n\n");

function answerResponse(): Record<string, unknown> {
  return {
    description:
      "The matching documentation pages. A plain request answers with the JSON document; a request that asked for streaming answers with the same results as an SSE stream.",
    headers: { "Access-Control-Allow-Origin": CORS_ORIGIN_HEADER },
    content: {
      [JSON_MEDIA_TYPE]: { schema: { $ref: "#/components/schemas/AskAnswer" } },
      [SSE_MEDIA_TYPE]: {
        schema: {
          type: "string",
          contentMediaType: SSE_MEDIA_TYPE,
          description:
            "A server-sent event stream: one `start` event, one `result` event per hit in rank order, then one `complete` event. Each `data:` payload is a JSON object — see `x-sse-events` for the schema of each event name.",
        },
        example: SSE_EXAMPLE,
      },
    },
    // OpenAPI 3.1 has no vocabulary for per-event SSE payloads, so the event
    // name → payload schema map is carried as an extension rather than left
    // to prose a client would have to parse.
    "x-sse-events": {
      start: { $ref: "#/components/schemas/AskStreamStart" },
      result: { $ref: "#/components/schemas/AskStreamResult" },
      complete: { $ref: "#/components/schemas/AskStreamComplete" },
    },
  };
}

function buildSchemas(): Record<string, unknown> {
  const metaSchema = (
    responseType: "answer" | "failure"
  ): Record<string, unknown> => ({
    type: "object",
    description: "Envelope metadata every /ask document carries.",
    required: ["response_type", "version"],
    properties: {
      response_type: {
        type: "string",
        const: responseType,
        description: `Always \`${responseType}\` on this document.`,
      },
      version: {
        type: "string",
        description: "NLWeb protocol revision this endpoint implements.",
        examples: [NLWEB_PROTOCOL_VERSION],
      },
      ...(responseType === "answer"
        ? {
            streaming: {
              type: "boolean",
              description:
                "Present on the `start` event of a stream, where it is `true`.",
            },
          }
        : {}),
    },
  });

  return {
    AskAnswerMeta: metaSchema("answer"),
    AskFailureMeta: metaSchema("failure"),
    AskResult: {
      type: "object",
      description: "One documentation page that matched the query.",
      required: [
        "url",
        "name",
        "site",
        "score",
        "description",
        "schema_object",
      ],
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "Absolute URL of the page.",
        },
        name: { type: "string", description: "Page title." },
        site: {
          type: "string",
          description:
            "Site token every result from this endpoint carries — the docs host.",
        },
        score: {
          type: "number",
          description:
            "Relevance score, higher is better. Comparable within one response, not across responses.",
        },
        description: {
          type: "string",
          description:
            "The page description, or the matching excerpt when the page has none.",
        },
        schema_object: {
          type: "object",
          description: "schema.org `TechArticle` describing the page.",
        },
      },
    },
    AskAnswer: {
      type: "object",
      description: "A successful /ask document.",
      required: ["query_id", "_meta", "results"],
      properties: {
        query_id: {
          type: "string",
          description:
            "The caller's `query_id` when one was supplied, otherwise a generated one.",
        },
        _meta: { $ref: "#/components/schemas/AskAnswerMeta" },
        results: {
          type: "array",
          description:
            "Matching pages in rank order. Empty when nothing matched.",
          items: { $ref: "#/components/schemas/AskResult" },
        },
      },
    },
    AskError: {
      type: "object",
      description:
        "Why the request failed, and what the caller can do about it.",
      required: ["code", "message", "resolution"],
      properties: {
        code: {
          type: "string",
          enum: ERROR_CODES,
          description: "Stable error code. Branch on this, not on `message`.",
        },
        message: { type: "string", description: "Human-readable summary." },
        resolution: {
          type: "string",
          description: "A short recovery hint for the caller. Always present.",
        },
      },
    },
    AskFailure: {
      type: "object",
      description:
        "A non-2xx /ask document. Every failure uses this envelope, including when the request asked for streaming.",
      required: ["query_id", "_meta", "error", "results"],
      properties: {
        query_id: {
          type: "string",
          description:
            "Echoes a supplied `query_id` so a rejected request can be correlated.",
        },
        _meta: { $ref: "#/components/schemas/AskFailureMeta" },
        error: { $ref: "#/components/schemas/AskError" },
        results: {
          type: "array",
          description: "Always empty on a failure.",
          maxItems: 0,
          items: { $ref: "#/components/schemas/AskResult" },
        },
      },
    },
    AskRequest: {
      type: "object",
      description:
        'An /ask request document. Both the flat REST shape (`{"query": "…"}`) and the NLWeb document shape (`{"query": {"text": "…"}}`) are accepted. Unknown fields are ignored. Every field may also be supplied as a URL parameter; the body wins when both are present.',
      properties: {
        query: {
          description:
            "The natural-language question. Required unless it is supplied as a `query`/`q` URL parameter.",
          oneOf: [
            { type: "string", description: "Flat REST shape." },
            {
              type: "object",
              description: "NLWeb document shape.",
              required: ["text"],
              properties: { text: { type: "string" } },
            },
          ],
        },
        query_id: {
          type: "string",
          description:
            "Caller-supplied correlation id, echoed on answers and failures. Generated when omitted.",
        },
        streaming: {
          description:
            "Flat streaming flag. Strings are truthy unless they are empty, `0`, `false`, or `no`.",
          oneOf: [{ type: "boolean" }, { type: "string" }],
        },
        prefer: {
          type: "object",
          description:
            "NLWeb preference block. Takes precedence over `streaming`.",
          properties: {
            streaming: { oneOf: [{ type: "boolean" }, { type: "string" }] },
          },
        },
      },
    },
    AskStreamStart: {
      type: "object",
      description: "Payload of the `start` event: the stream is open.",
      required: ["query_id", "_meta"],
      properties: {
        query_id: { type: "string" },
        _meta: { $ref: "#/components/schemas/AskAnswerMeta" },
      },
    },
    AskStreamResult: {
      type: "object",
      description: "Payload of a `result` event: one page, in rank order.",
      required: ["index", "item"],
      properties: {
        index: {
          type: "integer",
          minimum: 0,
          description: "Zero-based rank of this result within the stream.",
        },
        item: { $ref: "#/components/schemas/AskResult" },
      },
    },
    AskStreamComplete: {
      type: "object",
      description:
        "Payload of the `complete` event: every result has been sent and the stream is closed.",
      required: ["query_id", "_meta"],
      properties: {
        query_id: { type: "string" },
        _meta: { $ref: "#/components/schemas/AskAnswerMeta" },
      },
    },
  };
}

function buildParameters(): Record<string, unknown> {
  return {
    AskQuery: {
      name: "query",
      in: "query",
      required: false,
      description:
        "The natural-language question. Required on GET; on POST it may come from the body instead.",
      schema: { type: "string", minLength: 1 },
      example: "how do I configure redirects",
    },
    AskQueryAlias: {
      name: "q",
      in: "query",
      required: false,
      description: "Alias for `query`, used when `query` is absent.",
      schema: { type: "string", minLength: 1 },
    },
    AskQueryId: {
      name: "query_id",
      in: "query",
      required: false,
      description:
        "Correlation id echoed on answers and failures. A blank value counts as unsupplied.",
      schema: { type: "string" },
    },
    AskStreaming: {
      name: "streaming",
      in: "query",
      required: false,
      description:
        "Ask for the SSE stream instead of the JSON document. Truthy unless empty, `0`, `false`, or `no`. When omitted, an `Accept: text/event-stream` request header selects the stream.",
      schema: { type: "string" },
      examples: {
        on: { summary: "Stream the answer", value: "1" },
        off: { summary: "Force the JSON document", value: "0" },
      },
    },
  };
}

const QUERY_PARAMETER_REFS = [
  { $ref: "#/components/parameters/AskQuery" },
  { $ref: "#/components/parameters/AskQueryAlias" },
  { $ref: "#/components/parameters/AskQueryId" },
  { $ref: "#/components/parameters/AskStreaming" },
];

function buildResponses(): Record<string, unknown> {
  return {
    AskAnswer: answerResponse(),
    AskBadRequest: failureResponse(
      "The request could not be read as an /ask query.",
      [
        NLWEB_ERROR_CODES.missingQuery,
        NLWEB_ERROR_CODES.invalidJson,
        NLWEB_ERROR_CODES.invalidRequest,
      ]
    ),
    AskContentTooLarge: failureResponse(
      "The JSON request body exceeds the 16 KiB limit.",
      [NLWEB_ERROR_CODES.requestTooLarge]
    ),
    AskMethodNotAllowed: failureResponse(
      `Every method other than ${NLWEB_ALLOWED_METHODS} is rejected with this envelope.`,
      [NLWEB_ERROR_CODES.methodNotAllowed],
      {
        Allow: {
          description: "The methods the endpoint serves.",
          schema: { type: "string", const: NLWEB_ALLOWED_METHODS },
        },
      }
    ),
    AskInternalError: failureResponse(
      "The endpoint could not answer. `artifacts_unavailable` means the generated docs artifacts are missing where the handler runs; `internal_error` is anything else. Neither carries server-side detail.",
      [NLWEB_ERROR_CODES.artifactsUnavailable, NLWEB_ERROR_CODES.internalError]
    ),
    AskPreflight: {
      description: "CORS preflight. The only /ask response with no body.",
      headers: {
        "Access-Control-Allow-Origin": CORS_ORIGIN_HEADER,
        "Access-Control-Allow-Methods": {
          description: "The methods the endpoint serves.",
          schema: { type: "string", const: NLWEB_ALLOWED_METHODS },
        },
        "Access-Control-Allow-Headers": {
          description: "The request headers the endpoint accepts.",
          schema: { type: "string", const: NLWEB_ALLOWED_REQUEST_HEADERS },
        },
      },
    },
  };
}

const SHARED_ANSWER_RESPONSES = {
  "200": { $ref: "#/components/responses/AskAnswer" },
  "400": { $ref: "#/components/responses/AskBadRequest" },
};

const GET_ANSWER_RESPONSES = {
  ...SHARED_ANSWER_RESPONSES,
  "500": { $ref: "#/components/responses/AskInternalError" },
};

const POST_ANSWER_RESPONSES = {
  ...SHARED_ANSWER_RESPONSES,
  "413": { $ref: "#/components/responses/AskContentTooLarge" },
  "500": { $ref: "#/components/responses/AskInternalError" },
};

function buildPathItem(tag: string): Record<string, unknown> {
  return {
    summary: "Ask the documentation a natural-language question.",
    description: `Serves ${NLWEB_ALLOWED_METHODS}. Any other method answers \`405\` with the shared failure envelope (see \`x-leadtype-method-not-allowed\`) and an \`Allow\` header.`,
    // A 405 belongs to methods this document cannot declare an operation for,
    // so it is published here rather than bolted onto GET or POST, which never
    // return it.
    "x-leadtype-method-not-allowed": {
      methods: `Any method other than ${NLWEB_ALLOWED_METHODS}`,
      response: { $ref: "#/components/responses/AskMethodNotAllowed" },
    },
    get: {
      operationId: "nlwebAskGet",
      tags: [tag],
      summary: "Query the documentation with URL parameters.",
      description:
        "Runs a list-mode NLWeb query over the generated documentation artifacts and answers with the matching pages, best match first. No LLM is involved: results are search hits, deduplicated to the best hit per page. Answers with the JSON document unless streaming is requested, in which case the same results arrive as SSE `start`/`result`/`complete` events.",
      parameters: QUERY_PARAMETER_REFS,
      responses: GET_ANSWER_RESPONSES,
    },
    post: {
      operationId: "nlwebAskPost",
      tags: [tag],
      summary: "Query the documentation with an NLWeb request document.",
      description:
        "Same answer as `nlwebAskGet`, with the query supplied as JSON. Accepts the flat REST shape and the NLWeb document shape. The body is optional — an empty body answers from the URL parameters — and body fields win over URL parameters when both are present.",
      parameters: QUERY_PARAMETER_REFS,
      requestBody: {
        required: false,
        description:
          "The /ask request document. Omit it to answer from the URL parameters alone.",
        content: {
          [JSON_MEDIA_TYPE]: {
            schema: { $ref: "#/components/schemas/AskRequest" },
            examples: {
              flat: {
                summary: "Flat REST shape",
                value: { query: "how do I configure redirects" },
              },
              nlweb: {
                summary: "NLWeb document shape, streaming",
                value: {
                  query: { text: "how do I configure redirects" },
                  query_id: "01JF0000000000000000000000",
                  prefer: { streaming: true },
                },
              },
            },
          },
        },
      },
      responses: POST_ANSWER_RESPONSES,
    },
    options: {
      operationId: "nlwebAskOptions",
      tags: [tag],
      summary: "CORS preflight for the /ask endpoint.",
      description:
        "Answers `204` with the CORS headers and no body. Browsers send this automatically before a cross-origin `POST` with a JSON content type; it is not a call an agent needs to make itself.",
      parameters: [
        {
          name: "Origin",
          in: "header",
          required: false,
          description: "The requesting origin. Every origin is allowed.",
          schema: { type: "string" },
        },
        {
          name: "Access-Control-Request-Method",
          in: "header",
          required: false,
          description: `The method the browser intends to send. One of ${NLWEB_ALLOWED_METHODS}.`,
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": { $ref: "#/components/responses/AskPreflight" },
      },
    },
  };
}

function buildInfo(
  config: BuildAskOpenApiDocumentConfig
): Record<string, unknown> {
  const productName = config.product.name;
  return {
    title: `${productName} documentation query API`,
    summary: `Natural-language queries over the ${productName} documentation.`,
    description: [
      `An NLWeb \`/ask\` endpoint over the generated ${productName} documentation artifacts.`,
      "",
      "Queries answer in list mode — ranked documentation pages with their schema.org metadata, one entry per page. `mode=summarize` and `mode=generate` need an LLM and are not implemented.",
      "",
      "Responses are the JSON document by default and a server-sent event stream on request. Every failure uses one envelope with a stable `error.code`, so a client branches on the code rather than on the status text.",
    ].join("\n"),
    version: config.version ?? NLWEB_PROTOCOL_VERSION,
    "x-nlweb-protocol-version": NLWEB_PROTOCOL_VERSION,
  };
}

/**
 * Build the OpenAPI 3.1 description of the `/ask` endpoint a
 * `createAskHandler()` mount serves. Every operation carries a stable
 * `operationId`, a description, typed parameters, and typed responses, so it
 * converts to an LLM function definition without guesswork.
 */
export function buildAskOpenApiDocument(
  config: BuildAskOpenApiDocumentConfig
): AskOpenApiDocument {
  const location = resolveAskEndpointLocation(
    config.askEndpoint,
    config.baseUrl
  );
  const tag = "NLWeb";
  return withOpenApiOwnershipMarker({
    openapi: NLWEB_OPENAPI_VERSION,
    info: buildInfo(config),
    ...(location.serverUrl
      ? {
          servers: [
            {
              url: location.serverUrl,
              description: `${config.product.name} documentation site`,
            },
          ],
        }
      : {}),
    ...(config.docsUrl
      ? {
          externalDocs: {
            url: config.docsUrl,
            description: "Human-readable documentation for this endpoint.",
          },
        }
      : {}),
    tags: [
      {
        name: tag,
        description:
          "The NLWeb conversational surface over the documentation site.",
      },
    ],
    paths: { [location.pathKey]: buildPathItem(tag) },
    components: {
      schemas: buildSchemas() as Record<string, unknown>,
      parameters: buildParameters() as Record<string, unknown>,
      responses: buildResponses() as Record<string, unknown>,
    },
  });
}

/**
 * The RFC 9727 catalog member for the `/ask` endpoint, pointing `service-desc`
 * at the generated OpenAPI document.
 */
export function nlwebApiCatalogEntry(config: {
  askEndpoint?: string;
  openapiUrl?: string;
  docsUrl?: string;
  version?: string;
}): ApiCatalogEntry {
  const askEndpoint =
    config.askEndpoint === undefined
      ? DEFAULT_NLWEB_ASK_PATH
      : assertSafeNlwebAskEndpoint(config.askEndpoint);
  resolveAskEndpointLocation(askEndpoint);
  return {
    href: askEndpoint,
    title: NLWEB_API_CATALOG_TITLE,
    type: JSON_MEDIA_TYPE,
    version: config.version ?? NLWEB_PROTOCOL_VERSION,
    ...(config.openapiUrl
      ? {
          serviceDesc: {
            href: config.openapiUrl,
            type: NLWEB_OPENAPI_MEDIA_TYPE,
            title: "OpenAPI 3.1 description of the /ask endpoint",
          },
        }
      : {}),
    ...(config.docsUrl
      ? { serviceDoc: { href: config.docsUrl, type: "text/html" } }
      : {}),
  };
}

/** Compare catalog hrefs the way the catalog resolves them: `ask` is `/ask`. */
function sameCatalogHref(
  left: string,
  right: string,
  baseUrl?: string
): boolean {
  const normalize = (href: string): string => {
    const trimmed = href.trim();
    if (baseUrl?.trim()) {
      return new URL(trimmed, `${normalizeBaseUrl(baseUrl)}/`).toString();
    }
    if (ABSOLUTE_URL_PATTERN.test(trimmed)) {
      return new URL(trimmed).toString();
    }
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  };
  return normalize(left) === normalize(right);
}

/**
 * List the `/ask` endpoint in the site's API catalog. A site that already
 * declares the endpoint keeps its own entry — only a missing `service-desc` is
 * filled in, so the generated OpenAPI document is discoverable either way.
 */
export function withNlwebApiCatalogEntry(
  apis: ApiCatalogEntry[] | undefined,
  entry: ApiCatalogEntry,
  baseUrl?: string
): ApiCatalogEntry[] {
  const existing = apis ?? [];
  const match = existing.find((api) =>
    sameCatalogHref(api.href, entry.href, baseUrl)
  );
  if (!match) {
    return [...existing, entry];
  }
  const hasServiceDesc = Array.isArray(match.serviceDesc)
    ? match.serviceDesc.length > 0
    : match.serviceDesc !== undefined;
  if (hasServiceDesc) {
    return existing;
  }
  return existing.map((api) =>
    api === match ? { ...api, serviceDesc: entry.serviceDesc } : api
  );
}

/**
 * Write the OpenAPI document into the generate output root at the resolved
 * (already validated) relative path.
 */
export function renderAskOpenApiDocument(document: AskOpenApiDocument): string {
  return renderJson(document);
}

export async function writeAskOpenApiDocument(config: {
  outDir: string;
  output: string;
  document: AskOpenApiDocument;
}): Promise<string> {
  const output = assertSafeNlwebOpenApiOutput(config.output, "output");
  const outputPath = path.resolve(config.outDir, output);
  await mkdir(path.resolve(config.outDir), { recursive: true });
  await assertNlwebOutputPathInsideRoot(config.outDir, outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFileAtomic(outputPath, renderAskOpenApiDocument(config.document));
  return outputPath;
}
