import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { normalizeDocsPath, stripDocsExtension } from "../internal/docs-url";
import type { DocsNavNode } from "../llm";

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

const DEFAULT_OUTPUT_DIR = "api";
const DEFAULT_NAV_TITLE = "API Reference";
const DEFAULT_METHOD_ORDER = new Map<OpenApiHttpMethod, number>(
  HTTP_METHODS.map((method, index) => [method, index])
);
const CAMEL_CASE_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/g;
const POINTER_ESCAPE_PATTERN = /~[01]/g;
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/gi;
const DUPLICATE_DASH_PATTERN = /-+/g;
const LEADING_TRAILING_DASH_PATTERN = /^-|-$/g;

export type OpenApiHttpMethod = (typeof HTTP_METHODS)[number];

export type OpenApiSourceInput = string | OpenApiSourceConfig;

export type DocsOpenApiConfig = OpenApiSourceInput | OpenApiSourceInput[];

export type OpenApiSlugStrategy = "operation-id" | "method-path";

export type OpenApiSourceConfig = {
  /**
   * Local path or absolute URL to an OpenAPI 3.x JSON/YAML document.
   * Relative paths resolve from the config file directory.
   */
  input: string;
  /** Directory under the docs source where generated `.mdx` pages are written. */
  output?: string;
  /** Frontmatter group assigned to generated pages. */
  group?: string | string[];
  /** Starting frontmatter order. Each operation increments from this value. */
  order?: number;
  /** Parent navigation title for generated pages. */
  title?: string;
  /** Optional description for the generated navigation section. */
  description?: string;
  /** Include only operations with at least one matching tag. */
  includeTags?: string[];
  /** Exclude operations with any matching tag. */
  excludeTags?: string[];
  /** Split generated pages under tag folders and nav children. */
  groupByTags?: boolean;
  /** Override the server URL used in generated examples and try-it metadata. */
  serverUrl?: string;
  /** Prefer stable operation IDs or method/path slugs. Defaults to operation IDs. */
  slugStrategy?: OpenApiSlugStrategy;
  /** Emit an `ApiTryIt` component for renderers that support a native console. */
  includeTryIt?: boolean;
};

export type ResolvedOpenApiSourceConfig = Required<
  Pick<
    OpenApiSourceConfig,
    "groupByTags" | "includeTryIt" | "output" | "slugStrategy" | "title"
  >
> &
  Omit<
    OpenApiSourceConfig,
    "groupByTags" | "includeTryIt" | "output" | "slugStrategy" | "title"
  > & {
    cwd: string;
  };

export type OpenApiSchemaObject = Record<string, unknown>;

export type OpenApiSchemaSummary = {
  type: string;
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  properties?: OpenApiSchemaProperty[];
};

export type OpenApiSchemaProperty = OpenApiSchemaSummary & {
  name: string;
};

export type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  description?: string;
  required: boolean;
  deprecated?: boolean;
  schema?: OpenApiSchemaSummary;
  example?: unknown;
};

export type OpenApiMediaType = {
  mediaType: string;
  schema?: OpenApiSchemaSummary;
  example?: unknown;
  examples?: Record<string, unknown>;
};

export type OpenApiRequestBody = {
  description?: string;
  required: boolean;
  content: OpenApiMediaType[];
};

export type OpenApiResponse = {
  status: string;
  description: string;
  headers?: OpenApiParameter[];
  content: OpenApiMediaType[];
};

export type OpenApiSecurityScheme = {
  key: string;
  type: string;
  name?: string;
  in?: string;
  scheme?: string;
  bearerFormat?: string;
  description?: string;
  flows?: unknown;
  openIdConnectUrl?: string;
};

export type OpenApiSecurityRequirement = Record<string, string[]>;

export type OpenApiCodeSample = {
  label: string;
  language: string;
  code: string;
};

export type OpenApiOperation = {
  method: OpenApiHttpMethod;
  path: string;
  operationId?: string;
  title: string;
  description: string;
  summary?: string;
  tags: string[];
  deprecated: boolean;
  serverUrl?: string;
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: OpenApiResponse[];
  security: OpenApiSecurityRequirement[];
  securitySchemes: OpenApiSecurityScheme[];
  codeSamples: OpenApiCodeSample[];
};

export type GeneratedOpenApiPage = {
  filePath: string;
  relativePath: string;
  title: string;
  description: string;
  operation: OpenApiOperation;
};

export type GenerateOpenApiPagesResult = {
  pages: GeneratedOpenApiPage[];
  nav: DocsNavNode[];
};

type OperationCandidate = {
  method: OpenApiHttpMethod;
  path: string;
  operation: Record<string, unknown>;
  pathParameters: unknown[];
};

type LoadedDocument = {
  document: Record<string, unknown>;
  source: string;
};

type RefContext = {
  document: Record<string, unknown>;
  source: string;
  cwd: string;
  loaded: Map<string, LoadedDocument>;
};

type RefTarget = {
  value: unknown;
  context: RefContext;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOutputPath(input: string | undefined): string {
  const raw = input?.trim() || DEFAULT_OUTPUT_DIR;
  const normalized = normalizeDocsPath(raw).replace(/^\/+/, "");
  return normalized || DEFAULT_OUTPUT_DIR;
}

function slugify(input: string): string {
  const slug = input
    .trim()
    .replace(CAMEL_CASE_BOUNDARY_PATTERN, "$1-$2")
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_PATTERN, "-")
    .replace(DUPLICATE_DASH_PATTERN, "-")
    .replace(LEADING_TRAILING_DASH_PATTERN, "");
  return slug || "operation";
}

function titleize(input: string): string {
  return input
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function methodPathSlug(method: OpenApiHttpMethod, apiPath: string): string {
  const pathSlug = apiPath
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map(slugify)
    .join("-");
  return slugify(`${method}-${pathSlug || "root"}`);
}

function escapePointerSegment(segment: string): string {
  return segment.replace(POINTER_ESCAPE_PATTERN, (match) => {
    if (match === "~1") {
      return "/";
    }
    return "~";
  });
}

function readPointer(document: unknown, pointer: string): unknown {
  if (!pointer.startsWith("#/")) {
    return;
  }
  const segments = pointer
    .slice(2)
    .split("/")
    .map((segment) => escapePointerSegment(decodeURIComponent(segment)));
  let current = document;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (isRecord(current)) {
      current = current[segment];
      continue;
    }
    return;
  }
  return current;
}

async function readInput(input: string, cwd: string): Promise<LoadedDocument> {
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(
        `OpenAPI: failed to fetch "${input}" (${response.status} ${response.statusText})`
      );
    }
    const raw = await response.text();
    const parsed = YAML.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`OpenAPI: "${input}" did not parse to an object`);
    }
    return { document: parsed, source: input };
  }

  const filePath = path.isAbsolute(input) ? input : path.resolve(cwd, input);
  if (!existsSync(filePath)) {
    throw new Error(`OpenAPI: spec not found at "${filePath}"`);
  }
  const raw = await readFile(filePath, "utf8");
  const parsed = YAML.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`OpenAPI: "${filePath}" did not parse to an object`);
  }
  return { document: parsed, source: filePath };
}

async function loadExternalRef(
  ref: string,
  context: RefContext
): Promise<RefTarget> {
  const [targetInput = "", pointer = ""] = ref.split("#", 2);
  const baseDir = /^https?:\/\//i.test(context.source)
    ? context.source
    : path.dirname(context.source);
  let resolvedInput: string;
  if (/^https?:\/\//i.test(targetInput)) {
    resolvedInput = targetInput;
  } else if (/^https?:\/\//i.test(baseDir)) {
    resolvedInput = new URL(targetInput, baseDir).href;
  } else {
    resolvedInput = path.resolve(baseDir, targetInput);
  }

  let loaded = context.loaded.get(resolvedInput);
  if (!loaded) {
    loaded = await readInput(resolvedInput, context.cwd);
    context.loaded.set(resolvedInput, loaded);
  }

  const externalContext: RefContext = {
    cwd: context.cwd,
    document: loaded.document,
    loaded: context.loaded,
    source: loaded.source,
  };
  if (!pointer) {
    return { context: externalContext, value: loaded.document };
  }
  return {
    context: externalContext,
    value: readPointer(loaded.document, `#${pointer}`),
  };
}

async function dereferenceValue(
  value: unknown,
  context: RefContext,
  seen: Set<string>
): Promise<unknown> {
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      items.push(await dereferenceValue(item, context, seen));
    }
    return items;
  }

  if (!isRecord(value)) {
    return value;
  }

  const ref = asString(value.$ref);
  if (ref) {
    const cacheKey = `${context.source}:${ref}`;
    if (seen.has(cacheKey)) {
      return value;
    }
    seen.add(cacheKey);
    const target = ref.startsWith("#")
      ? { context, value: readPointer(context.document, ref) }
      : await loadExternalRef(ref, context);
    if (target.value === undefined) {
      throw new Error(`OpenAPI: unresolved $ref "${ref}" in ${context.source}`);
    }
    const resolved = await dereferenceValue(target.value, target.context, seen);
    seen.delete(cacheKey);
    return resolved;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = await dereferenceValue(entry, context, seen);
  }
  return output;
}

async function loadOpenApiDocument(
  input: string,
  cwd: string
): Promise<Record<string, unknown>> {
  const loaded = await readInput(input, cwd);
  const context: RefContext = {
    cwd,
    document: loaded.document,
    loaded: new Map([[loaded.source, loaded]]),
    source: loaded.source,
  };
  const dereferenced = await dereferenceValue(
    loaded.document,
    context,
    new Set()
  );
  if (!isRecord(dereferenced)) {
    throw new Error(`OpenAPI: "${input}" did not resolve to an object`);
  }
  validateOpenApiDocument(dereferenced, input);
  return dereferenced;
}

function validateOpenApiDocument(
  document: Record<string, unknown>,
  input: string
): void {
  const version = asString(document.openapi);
  if (!version?.startsWith("3.")) {
    throw new Error(
      `OpenAPI: "${input}" must be an OpenAPI 3.x document with an "openapi" field`
    );
  }
  if (!isRecord(document.paths)) {
    throw new Error(`OpenAPI: "${input}" must define a paths object`);
  }
}

function resolveOperationTitle(
  operation: Record<string, unknown>,
  method: OpenApiHttpMethod,
  apiPath: string
): string {
  const summary = asString(operation.summary);
  if (summary) {
    return summary;
  }
  const operationId = asString(operation.operationId);
  if (operationId) {
    return titleize(operationId);
  }
  return `${method.toUpperCase()} ${apiPath}`;
}

function resolveOperationDescription(
  operation: Record<string, unknown>,
  title: string
): string {
  return (
    asString(operation.description) ?? asString(operation.summary) ?? title
  );
}

function schemaType(schema: Record<string, unknown>): string {
  const ref = asString(schema.$ref);
  if (ref) {
    return ref.split("/").pop() ?? ref;
  }

  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues && enumValues.length > 0) {
    return enumValues.map((entry) => JSON.stringify(entry)).join(" | ");
  }

  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
  if (oneOf && oneOf.length > 0) {
    return oneOf.map((entry) => schemaTypeFromUnknown(entry)).join(" | ");
  }

  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : undefined;
  if (anyOf && anyOf.length > 0) {
    return anyOf.map((entry) => schemaTypeFromUnknown(entry)).join(" | ");
  }

  const allOf = Array.isArray(schema.allOf) ? schema.allOf : undefined;
  if (allOf && allOf.length > 0) {
    return allOf.map((entry) => schemaTypeFromUnknown(entry)).join(" & ");
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    return type.filter((entry) => typeof entry === "string").join(" | ");
  }

  if (type === "array") {
    const items = schemaTypeFromUnknown(schema.items);
    return `${items}[]`;
  }

  if (type === "object" || isRecord(schema.properties)) {
    return "object";
  }

  return typeof type === "string" ? type : "unknown";
}

function schemaTypeFromUnknown(value: unknown): string {
  return isRecord(value) ? schemaType(value) : "unknown";
}

function summarizeSchema(
  value: unknown,
  required = false
): OpenApiSchemaSummary | undefined {
  if (!isRecord(value)) {
    return;
  }

  const requiredNames = new Set(asStringArray(value.required));
  const properties: OpenApiSchemaProperty[] = [];
  if (isRecord(value.properties)) {
    for (const [name, property] of Object.entries(value.properties)) {
      const summary = summarizeSchema(property, requiredNames.has(name));
      if (!summary) {
        continue;
      }
      properties.push({ name, ...summary });
    }
  }

  return {
    type: schemaType(value),
    ...(asString(value.description)
      ? { description: asString(value.description) }
      : {}),
    ...(required ? { required } : {}),
    ...(value.deprecated === true ? { deprecated: true } : {}),
    ...(value.default === undefined ? {} : { default: value.default }),
    ...(Array.isArray(value.enum) ? { enum: value.enum } : {}),
    ...(asString(value.format) ? { format: asString(value.format) } : {}),
    ...(properties.length > 0 ? { properties } : {}),
  };
}

function normalizeParameter(value: unknown): OpenApiParameter | undefined {
  if (!isRecord(value)) {
    return;
  }
  const name = asString(value.name);
  const location = asString(value.in);
  if (
    !(
      name &&
      (location === "path" ||
        location === "query" ||
        location === "header" ||
        location === "cookie")
    )
  ) {
    return;
  }
  return {
    name,
    in: location,
    required: value.required === true || location === "path",
    ...(asString(value.description)
      ? { description: asString(value.description) }
      : {}),
    ...(value.deprecated === true ? { deprecated: true } : {}),
    ...(summarizeSchema(value.schema)
      ? { schema: summarizeSchema(value.schema) }
      : {}),
    ...(value.example === undefined ? {} : { example: value.example }),
  };
}

function normalizeMediaTypes(content: unknown): OpenApiMediaType[] {
  if (!isRecord(content)) {
    return [];
  }
  const mediaTypes: OpenApiMediaType[] = [];
  for (const [mediaType, value] of Object.entries(content)) {
    if (!isRecord(value)) {
      continue;
    }
    mediaTypes.push({
      mediaType,
      ...(summarizeSchema(value.schema)
        ? { schema: summarizeSchema(value.schema) }
        : {}),
      ...(value.example === undefined ? {} : { example: value.example }),
      ...(isRecord(value.examples) ? { examples: value.examples } : {}),
    });
  }
  return mediaTypes;
}

function normalizeRequestBody(value: unknown): OpenApiRequestBody | undefined {
  if (!isRecord(value)) {
    return;
  }
  return {
    required: value.required === true,
    ...(asString(value.description)
      ? { description: asString(value.description) }
      : {}),
    content: normalizeMediaTypes(value.content),
  };
}

function normalizeResponses(value: unknown): OpenApiResponse[] {
  if (!isRecord(value)) {
    return [];
  }
  const responses: OpenApiResponse[] = [];
  for (const [status, response] of Object.entries(value)) {
    if (!isRecord(response)) {
      continue;
    }
    const headers: OpenApiParameter[] = [];
    if (isRecord(response.headers)) {
      for (const [name, header] of Object.entries(response.headers)) {
        const normalized = normalizeParameter({
          name,
          in: "header",
          ...asRecord(header),
        });
        if (normalized) {
          headers.push(normalized);
        }
      }
    }
    responses.push({
      status,
      description: asString(response.description) ?? "",
      ...(headers.length > 0 ? { headers } : {}),
      content: normalizeMediaTypes(response.content),
    });
  }
  return responses.sort((left, right) =>
    left.status.localeCompare(right.status)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeSecuritySchemes(
  document: Record<string, unknown>
): OpenApiSecurityScheme[] {
  const components = asRecord(document.components);
  const schemes = asRecord(components.securitySchemes);
  const normalized: OpenApiSecurityScheme[] = [];
  for (const [key, value] of Object.entries(schemes)) {
    if (!isRecord(value)) {
      continue;
    }
    const type = asString(value.type);
    if (!type) {
      continue;
    }
    normalized.push({
      key,
      type,
      ...(asString(value.name) ? { name: asString(value.name) } : {}),
      ...(asString(value.in) ? { in: asString(value.in) } : {}),
      ...(asString(value.scheme) ? { scheme: asString(value.scheme) } : {}),
      ...(asString(value.bearerFormat)
        ? { bearerFormat: asString(value.bearerFormat) }
        : {}),
      ...(asString(value.description)
        ? { description: asString(value.description) }
        : {}),
      ...(value.flows === undefined ? {} : { flows: value.flows }),
      ...(asString(value.openIdConnectUrl)
        ? { openIdConnectUrl: asString(value.openIdConnectUrl) }
        : {}),
    });
  }
  return normalized;
}

function normalizeSecurity(value: unknown): OpenApiSecurityRequirement[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const requirements: OpenApiSecurityRequirement[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const requirement: OpenApiSecurityRequirement = {};
    for (const [key, scopes] of Object.entries(entry)) {
      requirement[key] = asStringArray(scopes);
    }
    requirements.push(requirement);
  }
  return requirements;
}

function firstServerUrl(
  document: Record<string, unknown>,
  operation: Record<string, unknown>,
  config: ResolvedOpenApiSourceConfig
): string | undefined {
  if (config.serverUrl) {
    return config.serverUrl;
  }
  const operationServers = Array.isArray(operation.servers)
    ? operation.servers
    : undefined;
  const documentServers = Array.isArray(document.servers)
    ? document.servers
    : undefined;
  const servers = operationServers ?? documentServers ?? [];
  for (const server of servers) {
    if (!isRecord(server)) {
      continue;
    }
    const url = asString(server.url);
    if (url) {
      return url;
    }
  }
  return;
}

function collectOperationCandidates(
  document: Record<string, unknown>
): OperationCandidate[] {
  const paths = asRecord(document.paths);
  const candidates: OperationCandidate[] = [];
  for (const [apiPath, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    const pathParameters = Array.isArray(pathItem.parameters)
      ? pathItem.parameters
      : [];
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isRecord(operation)) {
        continue;
      }
      candidates.push({ method, operation, path: apiPath, pathParameters });
    }
  }
  return candidates.sort((left, right) => {
    const pathCompare = left.path.localeCompare(right.path);
    if (pathCompare !== 0) {
      return pathCompare;
    }
    return (
      (DEFAULT_METHOD_ORDER.get(left.method) ?? 99) -
      (DEFAULT_METHOD_ORDER.get(right.method) ?? 99)
    );
  });
}

function shouldIncludeOperation(
  operation: Record<string, unknown>,
  config: ResolvedOpenApiSourceConfig
): boolean {
  const tags = asStringArray(operation.tags);
  if (config.includeTags && config.includeTags.length > 0) {
    const include = tags.some((tag) => config.includeTags?.includes(tag));
    if (!include) {
      return false;
    }
  }
  if (config.excludeTags && config.excludeTags.length > 0) {
    return !tags.some((tag) => config.excludeTags?.includes(tag));
  }
  return true;
}

function codeSampleUrl(operation: OpenApiOperation): string {
  const server = operation.serverUrl?.replace(/\/+$/, "") ?? "";
  return `${server}${operation.path}`;
}

function buildCurlSample(operation: OpenApiOperation): string {
  const lines = [
    `curl -X ${operation.method.toUpperCase()} "${codeSampleUrl(operation)}"`,
  ];
  for (const parameter of operation.parameters) {
    if (parameter.in !== "header" || parameter.required !== true) {
      continue;
    }
    lines.push(`  -H "${parameter.name}: <value>"`);
  }
  const mediaType = operation.requestBody?.content[0]?.mediaType;
  if (mediaType) {
    lines.push(`  -H "Content-Type: ${mediaType}"`);
  }
  if (operation.requestBody) {
    lines.push("  -d '<request-body>'");
  }
  return lines.join(" \\\n");
}

function buildFetchSample(operation: OpenApiOperation): string {
  const headers: Record<string, string> = {};
  const mediaType = operation.requestBody?.content[0]?.mediaType;
  if (mediaType) {
    headers["Content-Type"] = mediaType;
  }
  const lines = [
    `const response = await fetch("${codeSampleUrl(operation)}", {`,
    `  method: "${operation.method.toUpperCase()}",`,
  ];
  if (Object.keys(headers).length > 0) {
    lines.push(
      `  headers: ${JSON.stringify(headers, null, 2).replaceAll("\n", "\n  ")},`
    );
  }
  if (operation.requestBody) {
    lines.push("  body: JSON.stringify({ /* request body */ }),");
  }
  lines.push("});", "const data = await response.json();");
  return lines.join("\n");
}

function normalizeOperation(
  candidate: OperationCandidate,
  document: Record<string, unknown>,
  config: ResolvedOpenApiSourceConfig
): OpenApiOperation {
  const { method, operation, path: apiPath, pathParameters } = candidate;
  const title = resolveOperationTitle(operation, method, apiPath);
  const description = resolveOperationDescription(operation, title);
  const parameters: OpenApiParameter[] = [];
  const seenParameters = new Set<string>();
  const allParameters = [
    ...pathParameters,
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ];
  for (const parameter of allParameters) {
    const normalized = normalizeParameter(parameter);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.in}:${normalized.name}`;
    if (seenParameters.has(key)) {
      continue;
    }
    seenParameters.add(key);
    parameters.push(normalized);
  }

  const security = normalizeSecurity(operation.security ?? document.security);
  const selectedSchemeNames = new Set(
    security.flatMap((requirement) => Object.keys(requirement))
  );
  const securitySchemes = normalizeSecuritySchemes(document).filter(
    (scheme) =>
      selectedSchemeNames.size === 0 || selectedSchemeNames.has(scheme.key)
  );

  const normalized: OpenApiOperation = {
    method,
    path: apiPath,
    title,
    description,
    tags: asStringArray(operation.tags),
    deprecated: operation.deprecated === true,
    parameters,
    responses: normalizeResponses(operation.responses),
    security,
    securitySchemes,
    codeSamples: [],
    ...(asString(operation.operationId)
      ? { operationId: asString(operation.operationId) }
      : {}),
    ...(asString(operation.summary)
      ? { summary: asString(operation.summary) }
      : {}),
    ...(firstServerUrl(document, operation, config)
      ? { serverUrl: firstServerUrl(document, operation, config) }
      : {}),
    ...(normalizeRequestBody(operation.requestBody)
      ? { requestBody: normalizeRequestBody(operation.requestBody) }
      : {}),
  };
  normalized.codeSamples = [
    { code: buildCurlSample(normalized), label: "cURL", language: "bash" },
    { code: buildFetchSample(normalized), label: "JavaScript", language: "ts" },
  ];
  return normalized;
}

export function normalizeOpenApiConfig(
  config: DocsOpenApiConfig,
  cwd: string
): ResolvedOpenApiSourceConfig[] {
  const inputs = Array.isArray(config) ? config : [config];
  return inputs.map((input) => {
    const source: OpenApiSourceConfig =
      typeof input === "string" ? { input } : input;
    return {
      ...source,
      cwd,
      groupByTags: source.groupByTags ?? true,
      includeTryIt: source.includeTryIt ?? false,
      output: normalizeOutputPath(source.output),
      slugStrategy: source.slugStrategy ?? "operation-id",
      title: source.title ?? DEFAULT_NAV_TITLE,
    };
  });
}

function operationSlug(
  operation: OpenApiOperation,
  config: ResolvedOpenApiSourceConfig
): string {
  if (config.slugStrategy === "operation-id" && operation.operationId) {
    return slugify(operation.operationId);
  }
  return methodPathSlug(operation.method, operation.path);
}

function operationRelativePath(
  operation: OpenApiOperation,
  config: ResolvedOpenApiSourceConfig,
  usedPaths: Set<string>
): string {
  const tag = operation.tags[0];
  const tagPath = config.groupByTags && tag ? slugify(tag) : "";
  const baseSlug = operationSlug(operation, config);
  let relativePath = normalizeDocsPath(
    path.posix.join(config.output, tagPath, `${baseSlug}.mdx`)
  );
  let counter = 2;
  while (usedPaths.has(relativePath.toLowerCase())) {
    relativePath = normalizeDocsPath(
      path.posix.join(config.output, tagPath, `${baseSlug}-${counter}.mdx`)
    );
    counter += 1;
  }
  usedPaths.add(relativePath.toLowerCase());
  return relativePath;
}

function serializeMdxExpression(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function mdxProp(name: string, value: unknown): string {
  if (typeof value === "string") {
    return `${name}=${JSON.stringify(value)}`;
  }
  if (typeof value === "boolean") {
    return value ? name : `${name}={false}`;
  }
  return `${name}={${serializeMdxExpression(value)}}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderFrontmatter(
  operation: OpenApiOperation,
  config: ResolvedOpenApiSourceConfig,
  index: number
): string {
  const lines = [
    "---",
    `title: ${yamlString(operation.title)}`,
    `description: ${yamlString(operation.description)}`,
  ];
  if (config.group) {
    lines.push(`group: ${JSON.stringify(config.group)}`);
  }
  if (config.order !== undefined) {
    lines.push(`order: ${config.order + index}`);
  }
  lines.push("generated: true", "source: openapi", "---");
  return lines.join("\n");
}

function renderMdxComponent(
  name: string,
  props: Record<string, unknown>
): string {
  const renderedProps = Object.entries(props)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => mdxProp(key, value))
    .join("\n  ");
  return `<${name}\n  ${renderedProps}\n/>`;
}

function parameterGroups(operation: OpenApiOperation): Array<{
  location: OpenApiParameter["in"];
  title: string;
  parameters: OpenApiParameter[];
}> {
  const labels = {
    cookie: "Cookie Parameters",
    header: "Header Parameters",
    path: "Path Parameters",
    query: "Query Parameters",
  } as const;
  const locations: OpenApiParameter["in"][] = [
    "path",
    "query",
    "header",
    "cookie",
  ];
  const groups: Array<{
    location: OpenApiParameter["in"];
    parameters: OpenApiParameter[];
    title: string;
  }> = [];
  for (const location of locations) {
    const parameters = operation.parameters.filter(
      (parameter) => parameter.in === location
    );
    if (parameters.length === 0) {
      continue;
    }
    groups.push({ location, parameters, title: labels[location] });
  }
  return groups;
}

function renderOperationMdx(
  operation: OpenApiOperation,
  config: ResolvedOpenApiSourceConfig,
  index: number
): string {
  const blocks = [
    renderFrontmatter(operation, config, index),
    "",
    `# ${operation.title}`,
    "",
    renderMdxComponent("ApiEndpoint", {
      deprecated: operation.deprecated,
      method: operation.method,
      operationId: operation.operationId,
      path: operation.path,
      serverUrl: operation.serverUrl,
    }),
    "",
    operation.description,
  ];

  if (operation.securitySchemes.length > 0 || operation.security.length > 0) {
    blocks.push(
      "",
      "## Authentication",
      "",
      renderMdxComponent("ApiAuth", {
        requirements: operation.security,
        schemes: operation.securitySchemes,
      })
    );
  }

  const groups = parameterGroups(operation);
  if (groups.length > 0 || operation.requestBody) {
    blocks.push("", "## Request");
    for (const group of groups) {
      blocks.push(
        "",
        renderMdxComponent("ApiParameters", {
          location: group.location,
          parameters: group.parameters,
          title: group.title,
        })
      );
    }
    if (operation.requestBody) {
      blocks.push(
        "",
        renderMdxComponent("ApiRequestBody", { body: operation.requestBody })
      );
    }
  }

  if (operation.codeSamples.length > 0) {
    blocks.push(
      "",
      "## Code Examples",
      "",
      renderMdxComponent("ApiCodeSamples", { samples: operation.codeSamples })
    );
  }

  if (operation.responses.length > 0) {
    blocks.push(
      "",
      "## Responses",
      "",
      renderMdxComponent("ApiResponses", { responses: operation.responses })
    );
  }

  if (config.includeTryIt) {
    blocks.push(
      "",
      "## Try It",
      "",
      renderMdxComponent("ApiTryIt", { operation })
    );
  }

  return `${blocks.join("\n")}\n`;
}

function buildGeneratedNav(
  pages: GeneratedOpenApiPage[],
  config: ResolvedOpenApiSourceConfig
): DocsNavNode | undefined {
  if (pages.length === 0) {
    return;
  }
  const base = stripDocsExtension(config.output);
  if (!config.groupByTags) {
    return {
      title: config.title,
      ...(config.description ? { description: config.description } : {}),
      base,
      pages: pages.map((page) =>
        stripDocsExtension(
          path.posix.relative(config.output, page.relativePath)
        )
      ),
    };
  }

  const byTag = new Map<string, GeneratedOpenApiPage[]>();
  for (const page of pages) {
    const tag = page.operation.tags[0] ?? "Operations";
    const existing = byTag.get(tag) ?? [];
    existing.push(page);
    byTag.set(tag, existing);
  }

  return {
    title: config.title,
    ...(config.description ? { description: config.description } : {}),
    base,
    children: [...byTag.entries()].map(([tag, tagPages]) => ({
      title: tag,
      base: slugify(tag),
      pages: tagPages.map((page) =>
        stripDocsExtension(
          path.posix.relative(
            path.posix.join(config.output, slugify(tag)),
            page.relativePath
          )
        )
      ),
    })),
  };
}

export async function generateOpenApiPages(
  config: ResolvedOpenApiSourceConfig
): Promise<GenerateOpenApiPagesResult> {
  const document = await loadOpenApiDocument(config.input, config.cwd);
  const candidates = collectOperationCandidates(document).filter((candidate) =>
    shouldIncludeOperation(candidate.operation, config)
  );
  const usedPaths = new Set<string>();
  const pages: GeneratedOpenApiPage[] = [];
  for (const candidate of candidates) {
    const operation = normalizeOperation(candidate, document, config);
    const relativePath = operationRelativePath(operation, config, usedPaths);
    pages.push({
      description: operation.description,
      filePath: relativePath,
      operation,
      relativePath,
      title: operation.title,
    });
  }
  const nav = buildGeneratedNav(pages, config);
  return {
    pages,
    nav: nav ? [nav] : [],
  };
}

export type WriteOpenApiPagesConfig = {
  configs: ResolvedOpenApiSourceConfig[];
  docsDir: string;
};

export async function writeOpenApiPages({
  configs,
  docsDir,
}: WriteOpenApiPagesConfig): Promise<GenerateOpenApiPagesResult> {
  const allPages: GeneratedOpenApiPage[] = [];
  const nav: DocsNavNode[] = [];
  for (const config of configs) {
    const generated = await generateOpenApiPages(config);
    for (const [index, page] of generated.pages.entries()) {
      const outputPath = path.join(docsDir, page.relativePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        renderOperationMdx(page.operation, config, index)
      );
      allPages.push({ ...page, filePath: outputPath });
    }
    nav.push(...generated.nav);
  }
  return { nav, pages: allPages };
}
