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
  createUnorderedList,
  getAttributeValue,
} from "../libs";

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

function schemaRows(
  properties: OpenApiSchemaProperty[] | undefined
): (string | ReturnType<typeof createInlineCode>[])[][] {
  if (!properties || properties.length === 0) {
    return [];
  }
  return properties.map((property) => [
    [createInlineCode(property.name)],
    schemaLabel(property),
    requiredLabel(property.required),
    property.description ?? "",
  ]);
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

function renderMediaType(media: OpenApiMediaType): RootContent[] {
  const nodes: RootContent[] = [
    createParagraph(`Content type: ${media.mediaType}`),
  ];
  const rows = schemaRows(media.schema?.properties);
  if (rows.length > 0) {
    nodes.push(
      createTable(["Property", "Type", "Required", "Description"], rows)
    );
  } else if (media.schema) {
    nodes.push(createParagraph(`Schema: ${schemaLabel(media.schema)}`));
  }
  if (media.example !== undefined) {
    nodes.push(createCodeBlock(JSON.stringify(media.example, null, 2), "json"));
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

export function openApiToMarkdown(): Transformer<Root, Root> {
  const endpoint = createJsxComponentProcessor("ApiEndpoint", (node) => {
    const method = (getAttributeValue(node, "method") ?? "").toUpperCase();
    const apiPath = getAttributeValue(node, "path") ?? "";
    const operationId = getAttributeValue(node, "operationId");
    const serverUrl = getAttributeValue(node, "serverUrl");
    const deprecated = getAttributeValue(node, "deprecated") === "true";
    const lines = [
      `${method} ${apiPath}`,
      operationId ? `Operation ID: ${operationId}` : "",
      serverUrl ? `Server: ${serverUrl}` : "",
      deprecated ? "Deprecated: true" : "",
    ].filter(Boolean);
    return [createParagraph(lines.join("\n"))];
  });

  const auth = createJsxComponentProcessor("ApiAuth", (node) => {
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
  });

  const parameters = createJsxComponentProcessor("ApiParameters", (node) => {
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
  });

  const requestBody = createJsxComponentProcessor("ApiRequestBody", (node) => {
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
  });

  const responses = createJsxComponentProcessor("ApiResponses", (node) => {
    const parsed = parseAttr<OpenApiResponse[]>(
      getAttributeValue(node, "responses"),
      []
    );
    if (parsed.length === 0) {
      return [createParagraph("No responses documented.")];
    }
    return parsed.flatMap(renderResponse);
  });

  const codeSamples = createJsxComponentProcessor("ApiCodeSamples", (node) => {
    const samples = parseAttr<OpenApiCodeSample[]>(
      getAttributeValue(node, "samples"),
      []
    );
    return renderCodeSamples(samples);
  });

  const tryIt = createJsxComponentProcessor("ApiTryIt", () => [
    createParagraph(
      "Interactive API console metadata is available to the docs renderer."
    ),
  ]);

  return (tree) => {
    endpoint(tree);
    auth(tree);
    parameters(tree);
    requestBody(tree);
    responses(tree);
    codeSamples(tree);
    tryIt(tree);
  };
}
