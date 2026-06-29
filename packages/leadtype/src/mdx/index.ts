/** @biome-ignore lint/performance/noBarrelFile: dedicated package subpath */

/**
 * `leadtype/mdx` — consumer-facing MDX surface.
 *
 * Exports:
 *   - **Tag type contracts** for every custom MDX tag (`CalloutProps`,
 *     `TabsProps`, `TypeTableProps`, …). Implement components against these
 *     in your renderer.
 *   - **`createMdxSourcePlugins()` / `mdxSourcePlugins`** — remark preset for
 *     compiling source MDX in a host bundler (Next, Vite, fumadocs, …).
 *     Expands includes, resolves `<ExtractedTypeTable>`, strips authoring
 *     `import`s; preserves every other custom tag as JSX.
 *   - **`resolveInclude` / `parseIncludeSpecifier` / `extractMdxSection`** —
 *     low-level include-resolution helpers, framework-neutral.
 *
 * For the markdown-flattening pipeline used by the LLM/agent outputs, see
 * `leadtype/markdown` instead.
 */

// Canonical path / URL primitives so source consumers can derive slugs
// without reaching into `internal/`.
export {
  type DocsPathMount,
  normalizeBaseUrl,
  normalizeDocsPath,
  normalizeUrlPrefix,
  stripDocsExtension,
  toDocsUrlPath,
} from "../internal/docs-url";
// Include-resolution primitives (re-exports from the remark plugin file)
export {
  extractMdxSection,
  type IncludeResolution,
  parseIncludeSpecifier,
  type ResolveIncludeOptions,
  type ResolveIncludePathOptions,
  resolveInclude,
  resolveIncludePath,
} from "../remark/plugins/include.remark";
// Source preset for bundler consumers
export {
  createMdxSourcePlugins,
  type MdxSourcePluginsOptions,
  mdxSourcePlugins,
} from "./source-preset";
// Tag type contracts
export type {
  AccordionItemProps,
  AccordionProps,
  AudienceProps,
  AudienceTarget,
  CalloutProps,
  CalloutTypeAlias,
  CalloutVariant,
  CardProps,
  CardsProps,
  CardVariant,
  CommandMode,
  CommandTabsModeProps,
  CommandTabsProps,
  CommandTabsTemplateProps,
  DetailsProps,
  ExampleProps,
  ExampleSourceFile,
  ExtractedTypeTableProps,
  FileProps,
  FileTreeProps,
  FolderProps,
  MermaidProps,
  PackageManager,
  PromptProps,
  SectionProps,
  StepProps,
  StepsProps,
  TabProps,
  TabsProps,
  TopicSwitcherItem,
  TopicSwitcherProps,
  TypeTableProperty,
  TypeTableProps,
} from "./tag-types";
