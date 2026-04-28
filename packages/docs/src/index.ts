// Root entry for `@inth/docs`. Exposes config helpers used by docs sites,
// agent tooling, and the LLM-bundle pipeline. Specialized surfaces stay on
// dedicated subpaths (`@inth/docs/convert`, `/llm`, `/search`, `/lint`).
export {
  type CuratedLink,
  type DocsConfig,
  type DocsGroup,
  defineDocsConfig,
  type ProductInfo,
} from "./llm";
