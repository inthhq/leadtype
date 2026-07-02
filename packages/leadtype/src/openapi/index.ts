import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const CODE_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const CODE_SPAN_PATTERN = /(`+)([\s\S]*?)\1/g;
const AUTOLINK_PATTERN = /<(?:[a-z][a-z0-9+.-]*:|www\.)[^\s<>]*>/gi;
const MDX_UNSAFE_CHARACTER_PATTERN = /[<{}]/g;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const JSON_MEDIA_TYPE_PATTERN = /^application\/(?:.+\+)?json/i;
const BLANK_LINE_PATTERN = /\n\s*\n/;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const MAX_EXAMPLE_DEPTH = 6;

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
  example?: unknown;
  properties?: OpenApiSchemaProperty[];
  /** Item schema for arrays, so nested object items stay renderable. */
  items?: OpenApiSchemaSummary;
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

function escapeMdxPlainText(text: string): string {
  // Preserve CommonMark autolinks (`<https://…>`); escape every other `<`,
  // `{`, and `}` so arbitrary spec prose cannot open a JSX tag or expression.
  let output = "";
  let lastIndex = 0;
  for (const match of text.matchAll(AUTOLINK_PATTERN)) {
    const index = match.index ?? 0;
    output += text
      .slice(lastIndex, index)
      .replace(MDX_UNSAFE_CHARACTER_PATTERN, (char) => `\\${char}`);
    output += match[0];
    lastIndex = index + match[0].length;
  }
  output += text
    .slice(lastIndex)
    .replace(MDX_UNSAFE_CHARACTER_PATTERN, (char) => `\\${char}`);
  return output;
}

function escapeMdxInline(line: string): string {
  // Keep inline code spans verbatim; escape only the surrounding prose.
  let output = "";
  let lastIndex = 0;
  for (const match of line.matchAll(CODE_SPAN_PATTERN)) {
    const index = match.index ?? 0;
    output += escapeMdxPlainText(line.slice(lastIndex, index));
    output += match[0];
    lastIndex = index + match[0].length;
  }
  output += escapeMdxPlainText(line.slice(lastIndex));
  return output;
}

/**
 * Make CommonMark text (OpenAPI summaries/descriptions) safe to embed in an
 * MDX document body. Fenced code blocks, inline code spans, and autolinks are
 * preserved; `<`, `{`, and `}` in prose are backslash-escaped so they cannot
 * be parsed as JSX or expressions.
 */
export function escapeMarkdownForMdx(input: string): string {
  const lines = input.split("\n");
  const output: string[] = [];
  let openFence: string | null = null;
  for (const line of lines) {
    const fenceMatch = line.match(CODE_FENCE_PATTERN);
    if (openFence) {
      output.push(line);
      const closing = fenceMatch?.[1];
      if (
        closing?.startsWith(openFence[0] ?? "`") &&
        closing.length >= openFence.length
      ) {
        openFence = null;
      }
      continue;
    }
    if (fenceMatch?.[1]) {
      openFence = fenceMatch[1];
      output.push(line);
      continue;
    }
    output.push(escapeMdxInline(line));
  }
  return output.join("\n");
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

function unescapePointerSegment(segment: string): string {
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
    .map((segment) => unescapePointerSegment(decodeURIComponent(segment)));
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
    if (asString(document.swagger)) {
      throw new Error(
        `OpenAPI: "${input}" is a Swagger 2.0 document. Convert it to OpenAPI 3.x (e.g. with swagger2openapi) before generating docs.`
      );
    }
    throw new Error(
      `OpenAPI: "${input}" must be an OpenAPI 3.x document with an "openapi" field`
    );
  }
  // OpenAPI 3.1 allows webhooks-only documents; `paths` is optional there.
  if (!(isRecord(document.paths) || isRecord(document.webhooks))) {
    throw new Error(
      `OpenAPI: "${input}" must define a paths (or webhooks) object`
    );
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

function expandAllOfSources(
  value: Record<string, unknown>,
  depth = 0
): Record<string, unknown>[] {
  const sources: Record<string, unknown>[] = [value];
  if (depth >= MAX_EXAMPLE_DEPTH || !Array.isArray(value.allOf)) {
    return sources;
  }
  for (const member of value.allOf) {
    if (isRecord(member)) {
      sources.push(...expandAllOfSources(member, depth + 1));
    }
  }
  return sources;
}

function summarizeSchema(
  value: unknown,
  required = false
): OpenApiSchemaSummary | undefined {
  if (!isRecord(value)) {
    return;
  }

  // Merge `allOf` members so composed object schemas keep their full
  // property set (`required` arrays union across members, per OpenAPI).
  const sources = expandAllOfSources(value);
  const requiredNames = new Set(
    sources.flatMap((source) => asStringArray(source.required))
  );
  const mergedProperties = new Map<string, OpenApiSchemaProperty>();
  for (const source of sources) {
    if (!isRecord(source.properties)) {
      continue;
    }
    for (const [name, property] of Object.entries(source.properties)) {
      if (mergedProperties.has(name)) {
        continue;
      }
      const summary = summarizeSchema(property, requiredNames.has(name));
      if (summary) {
        mergedProperties.set(name, { name, ...summary });
      }
    }
  }
  const properties = [...mergedProperties.values()];
  const items = summarizeSchema(value.items);
  const description = asString(value.description);
  const format = asString(value.format);

  return {
    type: schemaType(value),
    ...(description ? { description } : {}),
    ...(required ? { required } : {}),
    ...(value.deprecated === true ? { deprecated: true } : {}),
    ...(value.default === undefined ? {} : { default: value.default }),
    ...(Array.isArray(value.enum) ? { enum: value.enum } : {}),
    ...(format ? { format } : {}),
    ...(value.example === undefined ? {} : { example: value.example }),
    ...(properties.length > 0 ? { properties } : {}),
    ...(items ? { items } : {}),
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
  const description = asString(value.description);
  const schema = summarizeSchema(value.schema);
  return {
    name,
    in: location,
    required: value.required === true || location === "path",
    ...(description ? { description } : {}),
    ...(value.deprecated === true ? { deprecated: true } : {}),
    ...(schema ? { schema } : {}),
    ...(value.example === undefined ? {} : { example: value.example }),
  };
}

/**
 * Build a representative example value from a schema summary. Explicit
 * `example` / `default` / first `enum` values win; otherwise the value is
 * synthesized from the type and format, matching what API reference UIs like
 * Mintlify and Fumadocs render when a spec omits examples.
 */
export function buildSchemaExample(
  schema: OpenApiSchemaSummary | undefined,
  depth = 0
): unknown {
  if (!schema || depth > MAX_EXAMPLE_DEPTH) {
    return null;
  }
  if (schema.example !== undefined) {
    return schema.example;
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (schema.properties && schema.properties.length > 0) {
    const output: Record<string, unknown> = {};
    for (const property of schema.properties) {
      output[property.name] = buildSchemaExample(property, depth + 1);
    }
    return output;
  }
  if (schema.type.endsWith("[]") || schema.items) {
    return schema.items ? [buildSchemaExample(schema.items, depth + 1)] : [];
  }
  const primary = schema.type.split(" | ")[0] ?? schema.type;
  switch (primary) {
    case "string":
      return exampleStringForFormat(schema.format);
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return true;
    case "null":
      return null;
    case "object":
    case "unknown":
      return {};
    default:
      // Named types (unresolvable/circular refs) fall back to an empty object.
      return {};
  }
}

function exampleStringForFormat(format: string | undefined): string {
  switch (format) {
    case "date-time":
      return "2024-01-15T09:30:00Z";
    case "date":
      return "2024-01-15";
    case "email":
      return "user@example.com";
    case "uuid":
      return "123e4567-e89b-12d3-a456-426614174000";
    case "uri":
    case "url":
      return "https://example.com";
    case "binary":
    case "byte":
      return "<binary>";
    default:
      return "string";
  }
}

function normalizeExamplesMap(
  value: Record<string, unknown>
): Record<string, unknown> {
  // OpenAPI `examples` entries are Example objects — surface their `value`.
  const output: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(value)) {
    output[name] =
      isRecord(entry) && entry.value !== undefined ? entry.value : entry;
  }
  return output;
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
    const schema = summarizeSchema(value.schema);
    const examples = isRecord(value.examples)
      ? normalizeExamplesMap(value.examples)
      : undefined;
    const hasNamedExamples = examples && Object.keys(examples).length > 0;
    // Synthesize an example for JSON media types so every page ships a
    // concrete payload even when the spec omits one.
    const example =
      value.example === undefined &&
      !hasNamedExamples &&
      schema &&
      JSON_MEDIA_TYPE_PATTERN.test(mediaType)
        ? buildSchemaExample(schema)
        : value.example;
    mediaTypes.push({
      mediaType,
      ...(schema ? { schema } : {}),
      ...(example === undefined ? {} : { example }),
      ...(hasNamedExamples ? { examples } : {}),
    });
  }
  return mediaTypes;
}

function normalizeRequestBody(value: unknown): OpenApiRequestBody | undefined {
  if (!isRecord(value)) {
    return;
  }
  const description = asString(value.description);
  return {
    required: value.required === true,
    ...(description ? { description } : {}),
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
    const name = asString(value.name);
    const location = asString(value.in);
    const scheme = asString(value.scheme);
    const bearerFormat = asString(value.bearerFormat);
    const description = asString(value.description);
    const openIdConnectUrl = asString(value.openIdConnectUrl);
    normalized.push({
      key,
      type,
      ...(name ? { name } : {}),
      ...(location ? { in: location } : {}),
      ...(scheme ? { scheme } : {}),
      ...(bearerFormat ? { bearerFormat } : {}),
      ...(description ? { description } : {}),
      ...(value.flows === undefined ? {} : { flows: value.flows }),
      ...(openIdConnectUrl ? { openIdConnectUrl } : {}),
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

function sampleParameterValue(parameter: OpenApiParameter): string {
  const value =
    parameter.example ??
    parameter.schema?.example ??
    parameter.schema?.default ??
    parameter.schema?.enum?.[0];
  if (value === undefined) {
    return `<${parameter.name}>`;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function requiredQueryString(operation: OpenApiOperation): string {
  const parts = operation.parameters
    .filter((parameter) => parameter.in === "query" && parameter.required)
    .map((parameter) => `${parameter.name}=${sampleParameterValue(parameter)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function codeSampleUrl(operation: OpenApiOperation): string {
  const server =
    operation.serverUrl?.replace(TRAILING_SLASHES_PATTERN, "") ?? "";
  return `${server}${operation.path}${requiredQueryString(operation)}`;
}

function authorizationHeader(scheme: OpenApiSecurityScheme): string[] | null {
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return ["Authorization", "Basic <credentials>"];
  }
  if (scheme.type === "http") {
    return ["Authorization", `Bearer <${scheme.bearerFormat ?? "token"}>`];
  }
  if (scheme.type === "apiKey" && scheme.name) {
    if (scheme.in === "header") {
      return [scheme.name, "<api-key>"];
    }
    if (scheme.in === "cookie") {
      return ["Cookie", `${scheme.name}=<api-key>`];
    }
    return null;
  }
  if (scheme.type === "oauth2" || scheme.type === "openIdConnect") {
    return ["Authorization", "Bearer <access-token>"];
  }
  return null;
}

function sampleHeaders(operation: OpenApiOperation): Map<string, string> {
  const headers = new Map<string, string>();
  // Auth for the first (preferred) security requirement.
  const requirement = operation.security[0];
  if (requirement) {
    for (const key of Object.keys(requirement)) {
      const scheme = operation.securitySchemes.find(
        (candidate) => candidate.key === key
      );
      const header = scheme ? authorizationHeader(scheme) : null;
      if (header && !headers.has(header[0] ?? "")) {
        headers.set(header[0] ?? "", header[1] ?? "");
      }
    }
  }
  for (const parameter of operation.parameters) {
    if (parameter.in !== "header" || parameter.required !== true) {
      continue;
    }
    if (!headers.has(parameter.name)) {
      headers.set(parameter.name, sampleParameterValue(parameter));
    }
  }
  const mediaType = operation.requestBody?.content[0]?.mediaType;
  if (mediaType && !headers.has("Content-Type")) {
    headers.set("Content-Type", mediaType);
  }
  return headers;
}

function sampleRequestBody(operation: OpenApiOperation): unknown {
  const media = operation.requestBody?.content[0];
  if (!media) {
    return;
  }
  if (media.example !== undefined) {
    return media.example;
  }
  if (media.schema) {
    return buildSchemaExample(media.schema);
  }
  return;
}

function buildCurlSample(operation: OpenApiOperation): string {
  const lines = [
    `curl -X ${operation.method.toUpperCase()} "${codeSampleUrl(operation)}"`,
  ];
  for (const [name, value] of sampleHeaders(operation)) {
    lines.push(`  -H "${name}: ${value}"`);
  }
  const body = sampleRequestBody(operation);
  if (body !== undefined) {
    const json = JSON.stringify(body, null, 2).replaceAll("'", "'\\''");
    lines.push(`  -d '${json}'`);
  }
  return lines.join(" \\\n");
}

function buildFetchSample(operation: OpenApiOperation): string {
  const headers = Object.fromEntries(sampleHeaders(operation));
  const lines = [
    `const response = await fetch("${codeSampleUrl(operation)}", {`,
    `  method: "${operation.method.toUpperCase()}",`,
  ];
  if (Object.keys(headers).length > 0) {
    lines.push(
      `  headers: ${JSON.stringify(headers, null, 2).replaceAll("\n", "\n  ")},`
    );
  }
  const body = sampleRequestBody(operation);
  if (body !== undefined) {
    const json = JSON.stringify(body, null, 2).replaceAll("\n", "\n  ");
    lines.push(`  body: JSON.stringify(${json}),`);
  }
  lines.push("});", "const data = await response.json();");
  return lines.join("\n");
}

function vendorCodeSamples(
  operation: Record<string, unknown>
): OpenApiCodeSample[] | undefined {
  // Redocly-style `x-codeSamples` (also `x-code-samples`) override generated
  // samples so spec authors can ship hand-written SDK snippets.
  const raw = operation["x-codeSamples"] ?? operation["x-code-samples"];
  if (!Array.isArray(raw)) {
    return;
  }
  const samples: OpenApiCodeSample[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const language = asString(entry.lang) ?? asString(entry.language);
    const code = asString(entry.source);
    if (!code) {
      continue;
    }
    samples.push({
      code,
      label: asString(entry.label) ?? language ?? "Example",
      language: (language ?? "text").toLowerCase(),
    });
  }
  return samples.length > 0 ? samples : undefined;
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
  // Only ship the schemes this operation's requirements reference. Operations
  // without security requirements are public — no auth section for them.
  const securitySchemes = normalizeSecuritySchemes(document).filter((scheme) =>
    selectedSchemeNames.has(scheme.key)
  );

  const operationId = asString(operation.operationId);
  const summary = asString(operation.summary);
  const serverUrl = firstServerUrl(document, operation, config);
  const requestBody = normalizeRequestBody(operation.requestBody);

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
    ...(operationId ? { operationId } : {}),
    ...(summary ? { summary } : {}),
    ...(serverUrl ? { serverUrl } : {}),
    ...(requestBody ? { requestBody } : {}),
  };
  normalized.codeSamples = vendorCodeSamples(operation) ?? [
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
  return inputs.map((input, index) => {
    const source: OpenApiSourceConfig =
      typeof input === "string" ? { input } : input;
    if (typeof source.input !== "string" || source.input.trim() === "") {
      throw new Error(
        `OpenAPI: config entry ${index} must set "input" to a spec path or URL`
      );
    }
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

/**
 * Validate an untyped `openapi` block from a loaded docs config. Returns the
 * typed config, throwing descriptive errors so config typos fail fast.
 */
export function validateDocsOpenApiConfig(
  value: unknown,
  label: string
): DocsOpenApiConfig | undefined {
  if (value === undefined) {
    return;
  }
  const entries = Array.isArray(value) ? value : [value];
  for (const [index, entry] of entries.entries()) {
    validateOpenApiEntry(entry, index, label);
  }
  return value as DocsOpenApiConfig;
}

function validateOpenApiEntry(
  entry: unknown,
  index: number,
  label: string
): void {
  const where = `${label}: openapi entry ${index}`;
  if (typeof entry === "string") {
    if (entry.trim() === "") {
      throw new Error(`${where} must be a non-empty spec path or URL`);
    }
    return;
  }
  if (!isRecord(entry)) {
    throw new Error(`${where} must be a string or { input, … } object`);
  }
  if (typeof entry.input !== "string" || entry.input.trim() === "") {
    throw new Error(`${where} must set "input" to a spec path or URL`);
  }
  const stringKeys = ["output", "serverUrl", "description"] as const;
  for (const key of stringKeys) {
    if (entry[key] !== undefined && typeof entry[key] !== "string") {
      throw new Error(`${where}: "${key}" must be a string`);
    }
  }
  if (entry.title !== undefined && typeof entry.title !== "string") {
    throw new Error(`${where}: "title" must be a string`);
  }
  if (
    entry.group !== undefined &&
    typeof entry.group !== "string" &&
    !(
      Array.isArray(entry.group) &&
      entry.group.every((item) => typeof item === "string")
    )
  ) {
    throw new Error(`${where}: "group" must be a string or string array`);
  }
  if (entry.order !== undefined && typeof entry.order !== "number") {
    throw new Error(`${where}: "order" must be a number`);
  }
  const tagKeys = ["includeTags", "excludeTags"] as const;
  for (const key of tagKeys) {
    const tags = entry[key];
    if (
      tags !== undefined &&
      !(Array.isArray(tags) && tags.every((tag) => typeof tag === "string"))
    ) {
      throw new Error(`${where}: "${key}" must be a string array`);
    }
  }
  const booleanKeys = ["groupByTags", "includeTryIt"] as const;
  for (const key of booleanKeys) {
    if (entry[key] !== undefined && typeof entry[key] !== "boolean") {
      throw new Error(`${where}: "${key}" must be a boolean`);
    }
  }
  if (
    entry.slugStrategy !== undefined &&
    entry.slugStrategy !== "operation-id" &&
    entry.slugStrategy !== "method-path"
  ) {
    throw new Error(
      `${where}: "slugStrategy" must be "operation-id" or "method-path"`
    );
  }
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

/**
 * Short, single-line description for frontmatter, nav, and search snippets.
 * Prefers the operation summary, then the first paragraph of the description.
 */
function shortDescription(operation: OpenApiOperation): string {
  const source =
    operation.summary ??
    operation.description.split(BLANK_LINE_PATTERN)[0] ??
    operation.title;
  return source.replace(WHITESPACE_RUN_PATTERN, " ").trim();
}

function renderFrontmatter(
  operation: OpenApiOperation,
  config: ResolvedOpenApiSourceConfig,
  index: number
): string {
  const lines = [
    "---",
    `title: ${yamlString(operation.title)}`,
    `description: ${yamlString(shortDescription(operation))}`,
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
  // No body `#` heading: the docs renderer prints the frontmatter title, and a
  // second h1 would duplicate it. Description text is CommonMark from the
  // spec, so escape MDX-significant syntax before embedding it in the body.
  const blocks = [
    renderFrontmatter(operation, config, index),
    "",
    renderMdxComponent("ApiEndpoint", {
      deprecated: operation.deprecated || undefined,
      method: operation.method,
      operationId: operation.operationId,
      path: operation.path,
      serverUrl: operation.serverUrl,
    }),
    "",
    escapeMarkdownForMdx(operation.description),
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
  config: ResolvedOpenApiSourceConfig,
  usedPaths: Set<string> = new Set()
): Promise<GenerateOpenApiPagesResult> {
  const document = await loadOpenApiDocument(config.input, config.cwd);
  const candidates = collectOperationCandidates(document).filter((candidate) =>
    shouldIncludeOperation(candidate.operation, config)
  );
  const pages: GeneratedOpenApiPage[] = [];
  for (const candidate of candidates) {
    const operation = normalizeOperation(candidate, document, config);
    const relativePath = operationRelativePath(operation, config, usedPaths);
    pages.push({
      description: shortDescription(operation),
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
  // One shared set so multiple specs targeting the same output directory get
  // collision suffixes instead of silently overwriting each other.
  const usedPaths = new Set<string>();
  for (const config of configs) {
    const generated = await generateOpenApiPages(config, usedPaths);
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

export type StageOpenApiDocsConfig = {
  /** Docs source directory to copy before writing generated pages. */
  contentDir: string;
  /** OpenAPI config, matching `DocsConfig["openapi"]`. */
  openapi: DocsOpenApiConfig;
  /** Base directory for relative `input` paths. Defaults to `contentDir`. */
  cwd?: string;
};

export type StagedOpenApiDocs = {
  /** Temp copy of `contentDir` with generated API pages written into it. */
  contentDir: string;
  /** Generated navigation nodes — append to your curated nav. */
  nav: DocsNavNode[];
  pages: GeneratedOpenApiPage[];
  /** Remove the staged copy. Call when the consuming build is done with it. */
  cleanup: () => Promise<void>;
};

/**
 * Stage a docs source directory with generated OpenAPI pages, without
 * touching the original source. This is the shared building block behind
 * `createDocsSource({ openapi })` and the package docs build — use it directly
 * when wiring a custom pipeline.
 */
export async function stageOpenApiDocs(
  config: StageOpenApiDocsConfig
): Promise<StagedOpenApiDocs> {
  const sourceDir = path.resolve(config.contentDir);
  if (!existsSync(sourceDir)) {
    throw new Error(`OpenAPI: contentDir does not exist at "${sourceDir}"`);
  }
  const stagedRoot = await mkdtemp(path.join(tmpdir(), "leadtype-openapi-"));
  const stagedContentDir = path.join(stagedRoot, path.basename(sourceDir));
  await cp(sourceDir, stagedContentDir, { recursive: true });
  const result = await writeOpenApiPages({
    configs: normalizeOpenApiConfig(config.openapi, config.cwd ?? sourceDir),
    docsDir: stagedContentDir,
  });
  return {
    cleanup: async () => {
      await rm(stagedRoot, { force: true, recursive: true });
    },
    contentDir: stagedContentDir,
    nav: result.nav,
    pages: result.pages,
  };
}
