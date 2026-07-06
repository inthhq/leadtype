/**
 * Native OpenAPI reference components for generated API pages.
 *
 * Prop contracts come from `leadtype/mdx` — the same shapes the generator
 * serializes into `<ApiEndpoint … />` / `<ApiResponses … />` MDX. Markup
 * follows this app's data-attribute convention (`data-leadtype-api-*`), with
 * styling in `src/styles.css`.
 */

import type {
  ApiAuthProps,
  ApiCodeSamplesProps,
  ApiEndpointProps,
  ApiMediaType,
  ApiParametersProps,
  ApiRequestBodyProps,
  ApiResponsesProps,
  ApiTryItProps,
} from "leadtype/mdx";
import { flattenApiSchemaRows } from "leadtype/mdx/openapi";
import { Callout } from "./callout";
import { Tab, Tabs } from "./tabs";

function formatSchemaType(schema?: { format?: string; type?: string }): string {
  if (!schema) {
    return "unknown";
  }
  return schema.format
    ? `${schema.type ?? "unknown"} (${schema.format})`
    : (schema.type ?? "unknown");
}

function SchemaTable({
  schema,
  nameHeading = "Property",
}: {
  schema?: ApiMediaType["schema"];
  nameHeading?: string;
}) {
  const rows = flattenApiSchemaRows(schema);
  if (rows.length === 0) {
    return null;
  }
  return (
    <div data-leadtype-api-table="">
      <table>
        <thead>
          <tr>
            <th>{nameHeading}</th>
            <th>Type</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>
                <code>{row.name}</code>
              </td>
              <td>
                <code>{row.type}</code>
              </td>
              <td>{row.required ? "Required" : "Optional"}</td>
              <td>{row.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonExample({ value }: { value: unknown }) {
  return (
    <pre data-language="json">
      <code>
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </code>
    </pre>
  );
}

function MediaTypeExamples({ media }: { media: ApiMediaType }) {
  const namedExamples = Object.entries(media.examples ?? {});
  if (namedExamples.length > 0) {
    return namedExamples.map(([name, value]) => (
      <div key={name}>
        <p data-leadtype-api-meta="">
          Example: <code>{name}</code>
        </p>
        <JsonExample value={value} />
      </div>
    ));
  }
  if (media.example === undefined) {
    return null;
  }
  return <JsonExample value={media.example} />;
}

function MediaType({ media }: { media: ApiMediaType }) {
  return (
    <div data-leadtype-api-media="">
      <p data-leadtype-api-meta="">
        Content type <code>{media.mediaType}</code>
      </p>
      <SchemaTable schema={media.schema} />
      <MediaTypeExamples media={media} />
      {media.rawSchema === undefined ? null : (
        <details data-leadtype-api-schema="">
          <summary>JSON Schema</summary>
          <JsonExample value={media.rawSchema} />
        </details>
      )}
    </div>
  );
}

export function ApiEndpoint({
  method,
  path,
  operationId,
  serverUrl,
  deprecated,
}: ApiEndpointProps) {
  return (
    <div data-leadtype-api-endpoint="">
      <div data-leadtype-api-endpoint-row="">
        <span data-leadtype-api-method="" data-method={method}>
          {method.toUpperCase()}
        </span>
        <code data-leadtype-api-path="">{path}</code>
        {deprecated ? (
          <span data-leadtype-api-deprecated="">Deprecated</span>
        ) : null}
      </div>
      {serverUrl || operationId ? (
        <dl data-leadtype-api-endpoint-details="">
          {serverUrl ? (
            <div>
              <dt>Server</dt>
              <dd>
                <code>{serverUrl}</code>
              </dd>
            </div>
          ) : null}
          {operationId ? (
            <div>
              <dt>Operation ID</dt>
              <dd>
                <code>{operationId}</code>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

export function ApiAuth({ requirements, schemes }: ApiAuthProps) {
  if (requirements.length === 0 && schemes.length === 0) {
    return <p>No authentication required.</p>;
  }
  const requirementCounts = new Map<string, number>();
  const requirementItems = requirements.map((requirement) => {
    const names = Object.keys(requirement);
    const label = names.length > 0 ? names.join(" + ") : "Anonymous";
    const occurrence = requirementCounts.get(label) ?? 0;
    requirementCounts.set(label, occurrence + 1);
    return { key: `${label}:${occurrence}`, label };
  });
  return (
    <div data-leadtype-api-auth="">
      <ul>
        {requirementItems.map((item) => (
          <li key={item.key}>{item.label}</li>
        ))}
      </ul>
      {schemes.length > 0 ? (
        <ul data-leadtype-api-schemes="">
          {schemes.map((scheme) => (
            <li key={scheme.key}>
              <code>{scheme.key}</code>: {scheme.type}
              {scheme.scheme ? ` / ${scheme.scheme}` : ""}
              {scheme.description ? ` — ${scheme.description}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ApiParameters({ title, parameters }: ApiParametersProps) {
  if (parameters.length === 0) {
    return null;
  }
  return (
    <section data-leadtype-api-parameters="">
      {title ? <h3>{title}</h3> : null}
      <div data-leadtype-api-table="">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Required</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {parameters.map((parameter) => (
              <tr key={`${parameter.in}:${parameter.name}`}>
                <td>
                  <code>{parameter.name}</code>
                </td>
                <td>
                  <code>{formatSchemaType(parameter.schema)}</code>
                </td>
                <td>{parameter.required ? "Required" : "Optional"}</td>
                <td>{parameter.description ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ApiRequestBody({ body }: ApiRequestBodyProps) {
  return (
    <section data-leadtype-api-request-body="">
      <h3>Request Body</h3>
      <p data-leadtype-api-meta="">
        {body.required ? "Required" : "Optional"}
        {body.description ? ` — ${body.description}` : ""}
      </p>
      {body.content.map((media) => (
        <MediaType key={media.mediaType} media={media} />
      ))}
    </section>
  );
}

export function ApiCodeSamples({ samples }: ApiCodeSamplesProps) {
  if (samples.length === 0) {
    return null;
  }
  return (
    <div data-leadtype-api-code-samples="">
      <Tabs items={samples.map((sample) => sample.label)}>
        {samples.map((sample) => (
          <Tab key={sample.label} value={sample.label}>
            <pre data-language={sample.language}>
              <code>{sample.code}</code>
            </pre>
          </Tab>
        ))}
      </Tabs>
    </div>
  );
}

export function ApiResponses({ responses }: ApiResponsesProps) {
  if (responses.length === 0) {
    return null;
  }
  return (
    <div data-leadtype-api-responses="">
      {responses.map((response) => (
        <section data-leadtype-api-response="" key={response.status}>
          <h3>
            <code>{response.status}</code>
          </h3>
          <p data-leadtype-api-meta="">{response.description}</p>
          {response.content.map((media) => (
            <MediaType key={media.mediaType} media={media} />
          ))}
          {response.headers && response.headers.length > 0 ? (
            <>
              <h4>Headers</h4>
              <div data-leadtype-api-table="">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {response.headers.map((header) => (
                      <tr key={header.name}>
                        <td>
                          <code>{header.name}</code>
                        </td>
                        <td>
                          <code>{formatSchemaType(header.schema)}</code>
                        </td>
                        <td>{header.description ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export function ApiTryIt({ operation }: ApiTryItProps) {
  return (
    <Callout title="Try it">
      Wire this component to your API proxy to execute{" "}
      <code>
        {operation.method.toUpperCase()} {operation.path}
      </code>
      .
    </Callout>
  );
}
