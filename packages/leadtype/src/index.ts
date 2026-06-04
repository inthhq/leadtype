// Root entry for `leadtype`. Exposes the docs source primitive and the
// config helpers used across docs sites, agent tooling, and the LLM-bundle
// pipeline. Specialized surfaces stay on dedicated subpaths:
//   - `leadtype/mdx` — tag types, source remark preset, include resolver
//   - `leadtype/fumadocs` — adapter for fumadocs-core's Source interface
//   - `leadtype/remark` — agent/LLM flattening plugins
//   - `leadtype/convert` — MDX → markdown helpers
//   - `leadtype/llm` — TOC extraction, slug helpers, agent readability
//   - `leadtype/search` — search index + per-host adapters
//   - `leadtype/lint` — frontmatter / meta.json validation
//   - `leadtype/transformers` — frontmatter schemas + lifecycle hook types

export {
  type AlternateLocaleLink,
  type DocsI18nConfig,
  type DocsI18nManifest,
  type DocsLocale,
  type DocsLocaleArtifactPaths,
  getAlternateLocaleLinks,
  type LocaleCode,
  listDocsLocales,
  normalizeDocsI18nConfig,
  resolveDocsLocale,
  stripLocaleFromDocsPath,
  toLocalizedDocsUrlPath,
  toLocalizedMarkdownUrlPath,
} from "./i18n";
export {
  type AgentReadabilityConfig,
  type AgentReadabilityManifest,
  type AgentReadabilityPage,
  type AgentReadabilityResult,
  type CuratedLink,
  type DocsCollection,
  type DocsConfig,
  type DocsFrontmatterSchema,
  type DocsGroup,
  type DocsLlmsConfig,
  type DocsNavEntry,
  type DocsNavIncludeEntry,
  type DocsNavNode,
  type DocsNavPageEntry,
  type DocsNavSortKey,
  type DocsPathMount,
  defineCollection,
  defineDocsConfig,
  type LlmsBlock,
  normalizeAgentReadabilityManifest,
  type OrganizationInfo,
  type ProductInfo,
  type ResolvedAgentInputs,
  resolveAgentInputs,
  type SourceConfigInheritance,
  type SourceConfigInheritField,
} from "./llm";
export {
  type CreateDocsSourceConfig,
  createDocsSource,
  type DocsPage,
  type DocsPageMeta,
  type DocsSource,
} from "./source";
