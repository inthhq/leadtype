import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type {
  AccordionItemProps,
  AudienceProps,
  CommandTabsProps,
  DetailsProps,
  ExampleProps,
  MermaidProps,
  PromptProps,
  TopicSwitcherProps,
  TypeTableProps,
} from "leadtype/mdx";
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
