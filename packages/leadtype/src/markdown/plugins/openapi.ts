import JSON5 from "json5";
import type { Code, ListItem, Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import type {
  OpenApiCodeSample,
  OpenApiMediaType,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSchemaProperty,
  OpenApiSchemaSummary,
  OpenApiSecurityRequirement,
  OpenApiSecurityScheme,
} from "../../openapi";
import {
  createHeading,
  createInlineCode,
  createJsxComponentProcessor,
  createListItem,
  createParagraph,
  createTable,
  createText,
  createUnorderedList,
  getAttributeValue,
  type MdxNode,
} from "../libs";

const MAX_SCHEMA_DEPTH = 6;

function createCodeBlock(value: string, lang: string): Code {
  return { type: "code", lang, value };
}

function parseAttr<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON5.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function requiredLabel(required: boolean | undefined): string {
  return required ? "required" : "optional";
}

function schemaLabel(
  schema: { type?: string; format?: string } | undefined
): string {
  if (!schema) {
    return "";
  }
  return schema.format
    ? `${schema.type ?? "unknown"} (${schema.format})`
    : (schema.type ?? "");
}

type SchemaRow = (string | ReturnType<typeof createInlineCode>[])[];

function appendSchemaRows(
  rows: SchemaRow[],
  properties: OpenApiSchemaProperty[],
  prefix: string,
  depth: number
): void {
  if (depth > MAX_SCHEMA_DEPTH) {
    return;
  }
  for (const property of properties) {
    const name = `${prefix}${property.name}`;
    rows.push([
      [createInlineCode(name)],
      schemaLabel(property),
      requiredLabel(property.required),
      property.description ?? "",
    ]);
    if (property.properties) {
      appendSchemaRows(rows, property.properties, `${name}.`, depth + 1);
    }
    if (property.items?.properties) {
      appendSchemaRows(
        rows,
        property.items.properties,
        `${name}[].`,
        depth + 1
      );
    }
  }
}

function schemaRows(schema: OpenApiSchemaSummary | undefined): SchemaRow[] {
  const rows: SchemaRow[] = [];
  if (schema?.properties) {
    appendSchemaRows(rows, schema.properties, "", 0);
  } else if (schema?.items?.properties) {
    // Root-level arrays: render item fields with an `[]` prefix.
    appendSchemaRows(rows, schema.items.properties, "[].", 0);
  }
  return rows;
}

function renderParameterTable(parameters: OpenApiParameter[]): RootContent[] {
  if (parameters.length === 0) {
    return [createParagraph("No parameters.")];
  }
  return [
    createTable(
      ["Name", "Type", "Required", "Description"],
      parameters.map((parameter) => [
        [createInlineCode(parameter.name)],
        schemaLabel(parameter.schema),
        requiredLabel(parameter.required),
        parameter.description ?? "",
      ])
    ),
  ];
}

function renderJsonExample(value: unknown): Code {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return createCodeBlock(text, "json");
}

function renderMediaType(media: OpenApiMediaType): RootContent[] {
  const nodes: RootContent[] = [
    createParagraph(`Content type: ${media.mediaType}`),
  ];
  const rows = schemaRows(media.schema);
  if (rows.length > 0) {
    nodes.push(
      createTable(["Property", "Type", "Required", "Description"], rows)
    );
  } else if (media.schema) {
    nodes.push(createParagraph(`Schema: ${schemaLabel(media.schema)}`));
  }
  if (media.examples) {
    for (const [name, value] of Object.entries(media.examples)) {
      nodes.push(createParagraph(`Example: ${name}`));
      nodes.push(renderJsonExample(value));
    }
  } else if (media.example !== undefined) {
    nodes.push(createParagraph("Example:"));
    nodes.push(renderJsonExample(media.example));
  }
  if (media.rawSchema !== undefined) {
    // The dereferenced contract, Vercel-docs style: full constraints (enums,
    // formats, required arrays) for agents and codegen.
    nodes.push(createParagraph("JSON Schema:"));
    nodes.push(renderJsonExample(media.rawSchema));
  }
  return nodes;
}

function renderSecurityScheme(scheme: OpenApiSecurityScheme): ListItem {
  const bits = [scheme.type];
  if (scheme.scheme) {
    bits.push(scheme.scheme);
  }
  if (scheme.name) {
    bits.push(scheme.name);
  }
  const label = bits.filter(Boolean).join(" / ");
  const description = scheme.description ? ` - ${scheme.description}` : "";
  return createListItem([
    createParagraph(`${scheme.key}: ${label}${description}`),
  ]);
}

function renderSecurityRequirements(
  requirements: OpenApiSecurityRequirement[]
): RootContent[] {
  if (requirements.length === 0) {
    return [createParagraph("No authentication required.")];
  }
  const items = requirements.map((requirement) => {
    const names = Object.keys(requirement);
    return createListItem([
      createParagraph(names.length > 0 ? names.join(" + ") : "Anonymous"),
    ]);
  });
  return [createUnorderedList(items)];
}

function renderCodeSamples(samples: OpenApiCodeSample[]): RootContent[] {
  const nodes: RootContent[] = [];
  for (const sample of samples) {
    nodes.push(createHeading(3, sample.label));
    nodes.push(createCodeBlock(sample.code, sample.language));
  }
  return nodes;
}

function renderResponse(response: OpenApiResponse): RootContent[] {
  const nodes: RootContent[] = [
    createHeading(3, response.status),
    createParagraph(response.description || "No description."),
  ];
  for (const media of response.content) {
    nodes.push(...renderMediaType(media));
  }
  if (response.headers && response.headers.length > 0) {
    nodes.push(createHeading(4, "Headers"));
    nodes.push(...renderParameterTable(response.headers));
  }
  return nodes;
}

function detailParagraph(label: string, value: string): RootContent {
  // Inline code keeps URLs and IDs verbatim (no markdown escaping artifacts).
  return {
    children: [createText(`${label}: `), createInlineCode(value)],
    type: "paragraph",
  };
}

export function apiEndpointToMarkdown(node: MdxNode): RootContent[] {
  const method = (getAttributeValue(node, "method") ?? "").toUpperCase();
  const apiPath = getAttributeValue(node, "path") ?? "";
  const operationId = getAttributeValue(node, "operationId");
  const serverUrl = getAttributeValue(node, "serverUrl");
  const deprecated = getAttributeValue(node, "deprecated") === "true";
  const nodes: RootContent[] = [
    createCodeBlock(`${method} ${apiPath}`, "http"),
  ];
  if (serverUrl) {
    nodes.push(detailParagraph("Server", serverUrl));
  }
  if (operationId) {
    nodes.push(detailParagraph("Operation ID", operationId));
  }
  if (deprecated) {
    nodes.push(createParagraph("Deprecated: true"));
  }
  return nodes;
}

export function apiAuthToMarkdown(node: MdxNode): RootContent[] {
  const schemes = parseAttr<OpenApiSecurityScheme[]>(
    getAttributeValue(node, "schemes"),
    []
  );
  const requirements = parseAttr<OpenApiSecurityRequirement[]>(
    getAttributeValue(node, "requirements"),
    []
  );
  const nodes: RootContent[] = [];
  nodes.push(...renderSecurityRequirements(requirements));
  if (schemes.length > 0) {
    nodes.push(createHeading(3, "Schemes"));
    nodes.push(createUnorderedList(schemes.map(renderSecurityScheme)));
  }
  return nodes;
}

export function apiParametersToMarkdown(node: MdxNode): RootContent[] {
  const title = getAttributeValue(node, "title");
  const parsed = parseAttr<OpenApiParameter[]>(
    getAttributeValue(node, "parameters"),
    []
  );
  const nodes: RootContent[] = [];
  if (title) {
    nodes.push(createHeading(3, title));
  }
  nodes.push(...renderParameterTable(parsed));
  return nodes;
}

export function apiRequestBodyToMarkdown(node: MdxNode): RootContent[] {
  const body = parseAttr<OpenApiRequestBody | null>(
    getAttributeValue(node, "body"),
    null
  );
  if (!body) {
    return [createParagraph("No request body.")];
  }
  const nodes: RootContent[] = [
    createHeading(3, "Request Body"),
    createParagraph(
      `${requiredLabel(body.required)}${body.description ? ` - ${body.description}` : ""}`
    ),
  ];
  for (const media of body.content) {
    nodes.push(...renderMediaType(media));
  }
  return nodes;
}

export function apiResponsesToMarkdown(node: MdxNode): RootContent[] {
  const parsed = parseAttr<OpenApiResponse[]>(
    getAttributeValue(node, "responses"),
    []
  );
  if (parsed.length === 0) {
    return [createParagraph("No responses documented.")];
  }
  return parsed.flatMap(renderResponse);
}

export function apiCodeSamplesToMarkdown(node: MdxNode): RootContent[] {
  const samples = parseAttr<OpenApiCodeSample[]>(
    getAttributeValue(node, "samples"),
    []
  );
  return renderCodeSamples(samples);
}

export function apiTryItToMarkdown(): RootContent[] {
  return [
    createParagraph(
      "Interactive API console metadata is available to the docs renderer."
    ),
  ];
}

export function openApiToMarkdown(): Transformer<Root, Root> {
  const processors = [
    createJsxComponentProcessor("ApiEndpoint", (node) =>
      apiEndpointToMarkdown(node)
    ),
    createJsxComponentProcessor("ApiAuth", (node) => apiAuthToMarkdown(node)),
    createJsxComponentProcessor("ApiParameters", (node) =>
      apiParametersToMarkdown(node)
    ),
    createJsxComponentProcessor("ApiRequestBody", (node) =>
      apiRequestBodyToMarkdown(node)
    ),
    createJsxComponentProcessor("ApiResponses", (node) =>
      apiResponsesToMarkdown(node)
    ),
    createJsxComponentProcessor("ApiCodeSamples", (node) =>
      apiCodeSamplesToMarkdown(node)
    ),
    createJsxComponentProcessor("ApiTryIt", () => apiTryItToMarkdown()),
  ];

  return (tree) => {
    for (const process of processors) {
      process(tree);
    }
  };
}
