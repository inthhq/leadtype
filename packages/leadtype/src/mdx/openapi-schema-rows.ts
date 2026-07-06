const MAX_SCHEMA_DEPTH = 6;

type ApiSchemaSummaryLike = {
  description?: string;
  format?: string;
  items?: ApiSchemaSummaryLike;
  properties?: ApiSchemaPropertyLike[];
  required?: boolean;
  type: string;
};

type ApiSchemaPropertyLike = ApiSchemaSummaryLike & {
  name: string;
};

export type ApiSchemaRow = {
  description?: string;
  name: string;
  required: boolean;
  type: string;
};

export type ApiSchemaRowsInput =
  | ApiSchemaPropertyLike[]
  | ApiSchemaSummaryLike
  | undefined;

function schemaLabel(schema: Pick<ApiSchemaSummaryLike, "format" | "type">) {
  return schema.format ? `${schema.type} (${schema.format})` : schema.type;
}

function appendSchemaRows(
  rows: ApiSchemaRow[],
  properties: ApiSchemaPropertyLike[],
  prefix: string,
  depth: number
): void {
  if (depth > MAX_SCHEMA_DEPTH) {
    return;
  }
  for (const property of properties) {
    const name = `${prefix}${property.name}`;
    rows.push({
      description: property.description,
      name,
      required: property.required === true,
      type: schemaLabel(property),
    });
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

export function flattenApiSchemaRows(
  input: ApiSchemaRowsInput
): ApiSchemaRow[] {
  const rows: ApiSchemaRow[] = [];
  if (Array.isArray(input)) {
    appendSchemaRows(rows, input, "", 0);
  } else if (input?.properties) {
    appendSchemaRows(rows, input.properties, "", 0);
  } else if (input?.items?.properties) {
    appendSchemaRows(rows, input.items.properties, "[].", 0);
  }
  return rows;
}
