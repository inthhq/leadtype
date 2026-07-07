/**
 * Type contracts for leadtype's custom MDX tags.
 *
 * These describe the **author surface** — the attributes that appear on a tag
 * in source MDX (e.g. `<Callout variant="warning">…</Callout>`). They are
 * framework-neutral on purpose: leadtype ships no renderer dependency, so
 * `children` defaults to `unknown`.
 *
 * Register your renderer's child type **once per project** via the
 * {@link ChildrenTypeRegistry} augmentation and every tag's `children`
 * becomes that type — no casts, no per-component generics:
 *
 * ```ts
 * // types.d.ts — register your renderer's child type (e.g. React's ReactNode)
 * declare module "leadtype/mdx" {
 *   interface ChildrenTypeRegistry {
 *     type: YourFrameworkChildType;
 *   }
 * }
 * export {}; // marks the file as a module so this augments, not replaces
 * ```
 *
 * Every tag type is part of the 1.0 contract — bumping the prop shape is a
 * breaking change.
 */
import type {
  OpenApiCodeSample,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSchemaProperty,
  OpenApiSecurityRequirement,
  OpenApiSecurityScheme,
} from "../openapi";

// ---------------------------------------------------------------------------
// Children typing
// ---------------------------------------------------------------------------

/**
 * Augmentation hook for the `children` type used by every tag's props.
 * Leadtype ships no renderer dependency, so this interface is empty by
 * default and `children` is `unknown`. Declare a `type` member for your
 * renderer once per project and every prop type picks it up:
 *
 * ```ts
 * declare module "leadtype/mdx" {
 *   interface ChildrenTypeRegistry {
 *     type: YourFrameworkChildType; // e.g. React's ReactNode
 *   }
 * }
 * export {}; // marks the file as a module so this augments, not replaces
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation hook by design
export interface ChildrenTypeRegistry {}

/**
 * The `children` type for all tag props: whatever the project registered in
 * {@link ChildrenTypeRegistry}, or `unknown` when nothing is registered.
 */
export type TagChildren = ChildrenTypeRegistry extends { type: infer T }
  ? T
  : unknown;

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

/** Stable variants accepted by the `variant` attribute on `<Callout>`. */
export type CalloutVariant =
  | "info"
  | "note"
  | "tip"
  | "warning"
  | "success"
  | "error"
  | "canary"
  | "deprecated"
  | "experimental";

/**
 * Legacy `type=` alias for `variant=`. Accepts the same values plus `"warn"`
 * (which normalizes to `"warning"`). New authoring should prefer `variant=`.
 */
export type CalloutTypeAlias = CalloutVariant | "warn";

export type CalloutProps = {
  variant?: CalloutVariant;
  /** @deprecated use {@link CalloutProps.variant} */
  type?: CalloutTypeAlias;
  title?: string;
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export type TabsProps = {
  /** Optional explicit list of tab labels; falls back to `<Tab value>` ordering. */
  items?: string[];
  /** Zero-based index of the tab shown on first render. */
  defaultIndex?: number;
  /** Shared id used to sync active tab across multiple `<Tabs>` instances. */
  groupId?: string;
  children?: TagChildren;
};

export type TabProps = {
  /** Identifier matched against the parent `<Tabs items>` list. */
  value: string;
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type StepsProps = {
  children?: TagChildren;
};

export type StepProps = {
  /** Optional heading rendered above the step body. */
  title?: string;
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// TypeTable (runtime + extractor variant)
// ---------------------------------------------------------------------------

export type TypeTableProperty = {
  type: string;
  description?: string;
  typeDescription?: string;
  typeDescriptionLink?: string;
  default?: string;
  required?: boolean;
  deprecated?: boolean;
};

export type TypeTableProps = {
  /**
   * Map of property name → property metadata. When using
   * `<ExtractedTypeTable>` or `<AutoTypeTable>`, leadtype's source preset
   * replaces the node with `<TypeTable>` and fills this from the parsed
   * TypeScript source. If extraction failed (file not found, `typescript`
   * not installed, wrong `basePath`), this is `{}` and `name`/`path` are
   * still passed through so the runtime component can render a placeholder.
   */
  properties: Record<string, TypeTableProperty>;
  title?: string;
  description?: string;
  /**
   * Original `name="…"` from `<ExtractedTypeTable>`. Set whether extraction
   * succeeded or not — useful for placeholder UI when `properties` is empty.
   */
  name?: string;
  /** Original `path="…"` from `<ExtractedTypeTable>`. */
  path?: string;
};

/**
 * Authoring-side shortcut. Replaced at build time by the source preset
 * with `<TypeTable properties={…} />` carrying the extracted properties.
 * Consumers do not normally implement a runtime component for this.
 */
export type ExtractedTypeTableProps = {
  /** Exported TypeScript identifier to extract from `path`. */
  name: string;
  /** Path to the TypeScript file containing `name`. */
  path: string;
  /** Override the extractor's base directory for `path` resolution. */
  basePath?: string;
  title?: string;
  description?: string;
};

// ---------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------

export type ApiSchemaProperty = OpenApiSchemaProperty;
export type ApiMediaType = OpenApiMediaType;

export type ApiEndpointProps = {
  method: OpenApiOperation["method"];
  path: string;
  operationId?: string;
  serverUrl?: string;
  deprecated?: boolean;
};

export type ApiAuthProps = {
  requirements: OpenApiSecurityRequirement[];
  schemes: OpenApiSecurityScheme[];
};

export type ApiParametersProps = {
  location: OpenApiParameter["in"];
  title?: string;
  parameters: OpenApiParameter[];
};

export type ApiRequestBodyProps = {
  body: OpenApiRequestBody;
};

export type ApiCodeSamplesProps = {
  samples: OpenApiCodeSample[];
};

export type ApiResponsesProps = {
  responses: OpenApiResponse[];
};

export type ApiTryItProps = {
  operation: OpenApiOperation;
};

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------

export type MermaidProps = {
  /** Mermaid source. Falls back to `children` when omitted. */
  chart?: string;
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// Accordion
// ---------------------------------------------------------------------------

export type AccordionProps = {
  children?: TagChildren;
};

export type AccordionItemProps = {
  title: string;
  defaultOpen?: boolean;
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// Cards / Card
// ---------------------------------------------------------------------------

export type CardsProps = {
  children?: TagChildren;
};

/** Built-in card layouts. Arbitrary strings still type-check for forward compat. */
export type CardVariant = "default" | "interactive" | (string & {});

export type CardProps = {
  href: string;
  title?: string;
  description?: string;
  /** Renderer decides how to display this; usually a small inline node. */
  icon?: unknown;
  variant?: CardVariant;
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// FileTree
// ---------------------------------------------------------------------------

export type FileTreeProps = {
  /** Label for the implicit root folder. */
  root?: string;
  children?: TagChildren;
};

export type FolderProps = {
  name: string;
  /** Render the folder open by default. */
  defaultOpen?: boolean;
  children?: TagChildren;
};

export type FileProps = {
  name: string;
};

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

export type AudienceTarget = "agent" | "human";

export type AudienceProps = {
  target: AudienceTarget;
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// CommandTabs
// ---------------------------------------------------------------------------

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type CommandMode = "run" | "install" | "create";

type CommandTabsCommon = {
  /** Preferred manager on first render. */
  defaultManager?: PackageManager;
};

/** Mode form: `<CommandTabs command="next dev" mode="run" />`. */
export type CommandTabsModeProps = CommandTabsCommon & {
  command: string;
  mode?: CommandMode;
  commands?: never;
};

/** Template form: `<CommandTabs commands={{ npm: "npx foo", bun: "bunx foo" }} />`. */
export type CommandTabsTemplateProps = CommandTabsCommon & {
  commands: Partial<Record<PackageManager, string>>;
  command?: never;
  mode?: never;
};

export type CommandTabsProps = CommandTabsModeProps | CommandTabsTemplateProps;

// ---------------------------------------------------------------------------
// TopicSwitcher
// ---------------------------------------------------------------------------

export type TopicSwitcherItem = {
  /** Stable identifier used by `activeValue`. */
  value: string;
  /** Display label. Falls back to `value` when omitted. */
  label?: string;
  description?: string;
  href?: string;
  /** Treat this item as the active topic regardless of `activeValue`. */
  current?: boolean;
};

export type TopicSwitcherProps = {
  items: TopicSwitcherItem[];
  /** Section label rendered above the switcher. */
  label?: string;
  /** Stable id of the currently active topic. */
  activeValue?: string;
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export type PromptProps = {
  title?: string;
  description?: string;
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// Example
// ---------------------------------------------------------------------------

export type ExampleSourceFile = {
  filename: string;
  language?: string;
  code: string;
};

export type ExampleProps = {
  title?: string;
  description?: string;
  filename?: string;
  language?: string;
  /** Primary code block when only one file is shown. */
  code?: string;
  /** Multi-file tabbed view; takes precedence over single-file `code`. */
  sourceFiles?: ExampleSourceFile[];
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// Section (semantic wrapper; usually stripped before render)
// ---------------------------------------------------------------------------

export type SectionProps = {
  /** Anchor id consumed by `<include src="…#id" />`. */
  id: string;
  children?: TagChildren;
};

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

export type DetailsProps = {
  /** First `<summary>` child becomes the disclosure label. */
  children?: TagChildren;
};
