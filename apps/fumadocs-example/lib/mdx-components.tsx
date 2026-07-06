import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type {
  AccordionItemProps,
  ApiAuthProps,
  ApiCodeSamplesProps,
  ApiEndpointProps,
  ApiMediaType,
  ApiParametersProps,
  ApiRequestBodyProps,
  ApiResponsesProps,
  ApiTryItProps,
  AudienceProps,
  CommandTabsProps,
  DetailsProps,
  ExampleProps,
  MermaidProps,
  PromptProps,
  TopicSwitcherProps,
  TypeTableProps,
} from "leadtype/mdx";
import { flattenApiSchemaRows } from "leadtype/mdx/openapi";
import type { ComponentProps, ComponentType, ReactNode } from "react";

/**
 * Map leadtype's custom MDX tag contract onto fumadocs-ui primitives.
 *
 * fumadocs-ui already covers most tags directly (Callout, Card, Steps, Tabs,
 * Files); a few tags need light adapters (Accordion → fumadocs Accordions /
 * Accordion, TypeTable, Audience).
 */

// Leadtype Accordion(container)/AccordionItem(item) → fumadocs Accordions/Accordion
function LeadtypeAccordion({ children }: { children?: ReactNode }) {
  return <Accordions type="single">{children}</Accordions>;
}

function LeadtypeAccordionItem({
  title,
  children,
  defaultOpen: _defaultOpen,
}: Omit<AccordionItemProps, "children"> & { children?: ReactNode }) {
  return <Accordion title={title}>{children}</Accordion>;
}

// Leadtype Audience tag: hide content targeted at agents.
function Audience({
  target,
  children,
}: Omit<AudienceProps, "children"> & { children?: ReactNode }) {
  if (target === "agent") {
    return null;
  }
  return <>{children}</>;
}

// Leadtype TypeTable: render the extracted properties as a simple table.
// When the source preset couldn't extract from TS (empty `properties` +
// `name`/`path` present), render a placeholder instead of an empty table.
function TypeTable({
  properties,
  title,
  description,
  name,
  path,
}: TypeTableProps) {
  const entries = Object.entries(properties ?? {});

  if (entries.length === 0 && (name || path)) {
    return (
      <div className="my-4 rounded-md border border-dashed p-3 text-sm opacity-70">
        <strong>{name ?? "Type"}</strong>
        {path ? <code className="ml-2 text-xs">{path}</code> : null}
        <p className="mt-1 text-xs">
          Extraction unavailable — install <code>typescript</code> in the docs
          app and configure <code>basePath</code> on the source preset.
        </p>
      </div>
    );
  }

  return (
    <div className="my-4 rounded-lg border">
      {title ? <h3 className="px-4 py-2 font-medium">{title}</h3> : null}
      {description ? (
        <p className="px-4 pb-2 text-sm opacity-80">{description}</p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="px-4 py-2">Property</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2">Default</th>
              <th className="px-4 py-2">Required</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([propName, property]) => (
              <tr className="border-b last:border-b-0" key={propName}>
                <td className="px-4 py-2 font-mono">{propName}</td>
                <td className="px-4 py-2 font-mono">{property.type}</td>
                <td className="px-4 py-2">{property.description ?? "—"}</td>
                <td className="px-4 py-2 font-mono">
                  {property.default ?? "—"}
                </td>
                <td className="px-4 py-2">
                  {property.required ? "Required" : "Optional"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SchemaRows({ schema }: { schema?: ApiMediaType["schema"] }) {
  const rows = flattenApiSchemaRows(schema);
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="px-4 py-2">Property</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Required</th>
            <th className="px-4 py-2">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b last:border-b-0" key={row.name}>
              <td className="px-4 py-2 font-mono">{row.name}</td>
              <td className="px-4 py-2 font-mono">{row.type}</td>
              <td className="px-4 py-2">
                {row.required ? "Required" : "Optional"}
              </td>
              <td className="px-4 py-2">{row.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatApiSchemaType(schema?: {
  format?: string;
  type?: string;
}): string {
  if (!schema) {
    return "unknown";
  }
  return schema.format
    ? `${schema.type ?? "unknown"} (${schema.format})`
    : (schema.type ?? "unknown");
}

function ApiEndpoint({
  method,
  path,
  operationId,
  serverUrl,
  deprecated,
}: ApiEndpointProps) {
  return (
    <div className="my-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border px-2 py-1 font-mono font-semibold text-xs uppercase">
          {method}
        </span>
        <code className="text-sm">{path}</code>
        {deprecated ? (
          <span className="rounded-md border px-2 py-1 text-xs">
            Deprecated
          </span>
        ) : null}
      </div>
      {operationId || serverUrl ? (
        <dl className="mt-3 grid gap-1 text-sm">
          {operationId ? (
            <div className="flex gap-2">
              <dt className="opacity-70">Operation ID</dt>
              <dd className="font-mono">{operationId}</dd>
            </div>
          ) : null}
          {serverUrl ? (
            <div className="flex gap-2">
              <dt className="opacity-70">Server</dt>
              <dd className="font-mono">{serverUrl}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

function ApiAuth({ requirements, schemes }: ApiAuthProps) {
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
    <div className="my-4 rounded-lg border p-4">
      {requirements.length > 0 ? (
        <>
          <h3 className="mt-0 font-medium text-base">Requirements</h3>
          <ul>
            {requirementItems.map((item) => (
              <li key={item.key}>{item.label}</li>
            ))}
          </ul>
        </>
      ) : null}
      {schemes.length > 0 ? (
        <>
          <h3 className="font-medium text-base">Schemes</h3>
          <ul>
            {schemes.map((scheme) => (
              <li key={scheme.key}>
                <code>{scheme.key}</code>: {scheme.type}
                {scheme.scheme ? ` / ${scheme.scheme}` : ""}
                {scheme.description ? ` - ${scheme.description}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function ApiParameters({ title, parameters }: ApiParametersProps) {
  if (parameters.length === 0) {
    return null;
  }
  return (
    <div className="my-4">
      {title ? <h3 className="font-medium text-base">{title}</h3> : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Required</th>
              <th className="px-4 py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {parameters.map((parameter) => (
              <tr
                className="border-b last:border-b-0"
                key={`${parameter.in}:${parameter.name}`}
              >
                <td className="px-4 py-2 font-mono">{parameter.name}</td>
                <td className="px-4 py-2 font-mono">
                  {formatApiSchemaType(parameter.schema)}
                </td>
                <td className="px-4 py-2">
                  {parameter.required ? "Required" : "Optional"}
                </td>
                <td className="px-4 py-2">{parameter.description ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        <p className="text-sm opacity-80">
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
    <div className="my-3">
      <p className="text-sm">
        Content type <code>{media.mediaType}</code>
      </p>
      <SchemaRows schema={media.schema} />
      <MediaTypeExamples media={media} />
      {media.rawSchema === undefined ? null : (
        <details className="my-2 rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">JSON Schema</summary>
          <JsonExample value={media.rawSchema} />
        </details>
      )}
    </div>
  );
}

function ApiRequestBody({ body }: ApiRequestBodyProps) {
  return (
    <div className="my-4 rounded-lg border p-4">
      <h3 className="mt-0 font-medium text-base">Request Body</h3>
      <p className="text-sm opacity-80">
        {body.required ? "Required" : "Optional"}
        {body.description ? ` - ${body.description}` : ""}
      </p>
      {body.content.map((media) => (
        <MediaType key={media.mediaType} media={media} />
      ))}
    </div>
  );
}

function ApiCodeSamples({ samples }: ApiCodeSamplesProps) {
  if (samples.length === 0) {
    return null;
  }
  return (
    <div className="my-4">
      {samples.map((sample) => (
        <div key={`${sample.label}:${sample.language}`}>
          <h3 className="font-medium text-base">{sample.label}</h3>
          <pre data-language={sample.language}>
            <code>{sample.code}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}

function ApiResponseHeaders({
  headers,
}: {
  headers: ApiResponsesProps["responses"][number]["headers"];
}) {
  if (!headers || headers.length === 0) {
    return null;
  }
  return (
    <div className="mt-3">
      <h4 className="font-medium text-sm">Headers</h4>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header) => (
              <tr className="border-b last:border-b-0" key={header.name}>
                <td className="px-4 py-2 font-mono">{header.name}</td>
                <td className="px-4 py-2 font-mono">
                  {formatApiSchemaType(header.schema)}
                </td>
                <td className="px-4 py-2">{header.description ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApiResponses({ responses }: ApiResponsesProps) {
  if (responses.length === 0) {
    return null;
  }
  return (
    <div className="my-4 grid gap-4">
      {responses.map((response) => (
        <section className="rounded-lg border p-4" key={response.status}>
          <h3 className="mt-0 font-medium text-base">
            <code>{response.status}</code>
          </h3>
          <p className="text-sm opacity-80">{response.description}</p>
          {response.content.map((media) => (
            <MediaType key={media.mediaType} media={media} />
          ))}
          <ApiResponseHeaders headers={response.headers} />
        </section>
      ))}
    </div>
  );
}

function ApiTryIt({ operation }: ApiTryItProps) {
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

// Leadtype CommandTabs: render the command per package manager.
function CommandTabs(props: CommandTabsProps) {
  const managers = ["npm", "pnpm", "yarn", "bun"] as const;
  const commands: Record<string, string> = {};
  if ("commands" in props && props.commands) {
    for (const manager of managers) {
      const value = props.commands[manager];
      if (value) {
        commands[manager] = value;
      }
    }
  } else if ("command" in props && props.command) {
    const mode = props.mode ?? "run";
    for (const manager of managers) {
      commands[manager] = formatCommand(manager, mode, props.command);
    }
  }

  const labels = Object.keys(commands);
  if (labels.length === 0) {
    return null;
  }

  return (
    <Tabs items={labels}>
      {labels.map((label) => (
        <Tab key={label} value={label}>
          <pre>
            <code>{commands[label]}</code>
          </pre>
        </Tab>
      ))}
    </Tabs>
  );
}

function formatCommand(
  manager: "npm" | "pnpm" | "yarn" | "bun",
  mode: "run" | "install" | "create",
  command: string
): string {
  if (mode === "install") {
    return manager === "npm"
      ? `npm install ${command}`
      : `${manager} add ${command}`;
  }
  if (mode === "create") {
    if (manager === "npm") {
      return `npm create ${command}`;
    }
    if (manager === "yarn") {
      return `yarn create ${command}`;
    }
    if (manager === "pnpm") {
      return `pnpm create ${command}`;
    }
    return `bun create ${command}`;
  }
  if (manager === "npm") {
    return `npx ${command}`;
  }
  if (manager === "pnpm") {
    return `pnpm dlx ${command}`;
  }
  if (manager === "yarn") {
    return `yarn dlx ${command}`;
  }
  return `bunx ${command}`;
}

function Prompt({
  title,
  description,
  children,
}: Omit<PromptProps, "children"> & { children?: ReactNode }) {
  return (
    <Callout title={title}>
      {description ? <p>{description}</p> : null}
      {children}
    </Callout>
  );
}

function Mermaid({ chart, children }: MermaidProps) {
  const source = chart ?? (typeof children === "string" ? children : "");
  return (
    <pre data-language="mermaid">
      <code>{source}</code>
    </pre>
  );
}

function Example({
  title,
  description,
  filename,
  language = "tsx",
  code,
  sourceFiles = [],
  children,
}: Omit<ExampleProps, "children"> & { children?: ReactNode }) {
  return (
    <div className="my-4 rounded-lg border p-4">
      {title ? <h3 className="mt-0 font-medium text-base">{title}</h3> : null}
      {description ? <p className="text-sm opacity-80">{description}</p> : null}
      {children}
      {code ? (
        <>
          {filename ? <p className="text-xs opacity-70">{filename}</p> : null}
          <pre data-language={language}>
            <code>{code}</code>
          </pre>
        </>
      ) : null}
      {sourceFiles.map((sourceFile) => (
        <div key={`${sourceFile.filename}:${sourceFile.language ?? "tsx"}`}>
          <p className="text-xs opacity-70">{sourceFile.filename}</p>
          <pre data-language={sourceFile.language ?? "tsx"}>
            <code>{sourceFile.code}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}

function TopicSwitcher({ items, label, activeValue }: TopicSwitcherProps) {
  return (
    <nav aria-label={label ?? "Topics"} className="my-4 rounded-lg border p-3">
      {label ? (
        <p className="mb-2 text-xs uppercase opacity-60">{label}</p>
      ) : null}
      <div className="grid gap-2">
        {items.map((item) => {
          const isActive = item.current || item.value === activeValue;
          const content = (
            <>
              <span className="font-medium">{item.label ?? item.value}</span>
              {item.description ? (
                <span className="block text-sm opacity-70">
                  {item.description}
                </span>
              ) : null}
            </>
          );
          return item.href ? (
            <a
              aria-current={isActive ? "page" : undefined}
              className="rounded-md border px-3 py-2 hover:bg-fd-accent"
              href={item.href}
              key={item.value}
            >
              {content}
            </a>
          ) : (
            <div className="rounded-md border px-3 py-2" key={item.value}>
              {content}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

interface SelectorProps {
  children?: ReactNode;
  defaultValue?: string;
  label?: string;
  options?: Array<{ label: string; value: string }>;
}

function Selector({
  children,
  defaultValue,
  label,
  options = [],
}: SelectorProps) {
  return (
    <div className="my-4 rounded-lg border p-3">
      {label ? <p className="font-medium text-sm">{label}</p> : null}
      {options.length > 0 ? (
        <p className="text-xs opacity-70">
          {options.find((option) => option.value === defaultValue)?.label ??
            options[0]?.label}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function Details({ children }: DetailsProps & { children?: ReactNode }) {
  return <details className="my-4 rounded-lg border p-3">{children}</details>;
}

function Section({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

function Hint({ children }: { children?: ReactNode }) {
  return <Callout>{children}</Callout>;
}

function Response({ children }: { children?: ReactNode }) {
  return <div className="my-4 rounded-lg border p-3">{children}</div>;
}

function Summary({ children, ...props }: ComponentProps<"summary">) {
  return (
    <summary className="cursor-pointer font-medium" {...props}>
      {children}
    </summary>
  );
}

const Passthrough: ComponentType<{ children?: ReactNode }> = ({ children }) => (
  <>{children}</>
);

export const mdxComponents = {
  ...defaultMdxComponents,
  // Leadtype contract → fumadocs-ui
  Callout,
  Tabs,
  Tab,
  Steps,
  Step,
  Cards,
  Card,
  Accordion: LeadtypeAccordion,
  AccordionItem: LeadtypeAccordionItem,
  FileTree: Files,
  File,
  Folder,
  TypeTable,
  AutoTypeTable: TypeTable,
  ExtractedTypeTable: TypeTable,
  ApiAuth,
  ApiCodeSamples,
  ApiEndpoint,
  ApiParameters,
  ApiRequestBody,
  ApiResponses,
  ApiTryIt,
  CommandTabs,
  // Compatibility aliases for external docs that use the same component map.
  PackageCommandTabs: CommandTabs,
  Prompt,
  Audience,
  Mermaid,
  Example,
  TopicSwitcher,
  Selector,
  Details,
  Section,
  Hint,
  Response,
  summary: Summary,
  // External-doc pass-throughs — root Leadtype docs do not render these.
  ConsentBanner: Passthrough,
  ConsentManager: Passthrough,
  ConsentManagerDialog: Passthrough,
  ConsentManagerProvider: Passthrough,
  ConsentManagerWidget: Passthrough,
  ConsentDialog: Passthrough,
  ConsentDialogTrigger: Passthrough,
  ConsentDialogLink: Passthrough,
  ConsentButton: Passthrough,
  ConsentWidget: Passthrough,
  CookieBanner: Passthrough,
  CustomConsentBanner: Passthrough,
  IABConsentBanner: Passthrough,
  IABConsentDialog: Passthrough,
  DevTools: Passthrough,
  Frame: Passthrough,
  C15tPrefetch: Passthrough,
  ContributorBlock: Passthrough,
  Icon: ({ name }: { name?: string }) => <span data-icon={name}>{name}</span>,
};
