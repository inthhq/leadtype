/** @biome-ignore lint/performance/noBarrelFile: package entry point */

export * from "./libs";
export { remarkAccordionToMarkdown } from "./plugins/accordion.remark";
export { remarkCalloutToMarkdown } from "./plugins/callout.remark";
export { remarkCardsToMarkdown } from "./plugins/cards.remark";
export { remarkCommandTabsToMarkdown } from "./plugins/command-tabs.remark";
export { remarkResolveDocPlaceholders } from "./plugins/doc-placeholders.remark";
export { remarkExampleToMarkdown } from "./plugins/example.remark";
export { remarkInclude } from "./plugins/include.remark";
export { remarkLinkIcon } from "./plugins/link-icon.remark";
export { remarkMermaidToMarkdown } from "./plugins/mermaid.remark";
export { remarkRemoveImports } from "./plugins/remove-imports.remark";
export { remarkStepsToMarkdown } from "./plugins/steps.remark";
export { remarkTabsToMarkdown } from "./plugins/tabs.remark";
export {
  extractTocFromContent,
  extractTocFromFile,
  type TOCItem,
} from "./plugins/toc-extract.remark";
export { remarkTopicSwitcherToMarkdown } from "./plugins/topic-switcher.remark";
export {
  extractTypeFromFile,
  remarkTypeTableToMarkdown,
} from "./plugins/type-table.remark";

import { remarkAccordionToMarkdown } from "./plugins/accordion.remark";
import { remarkCalloutToMarkdown } from "./plugins/callout.remark";
import { remarkCardsToMarkdown } from "./plugins/cards.remark";
import { remarkCommandTabsToMarkdown } from "./plugins/command-tabs.remark";
import { remarkResolveDocPlaceholders } from "./plugins/doc-placeholders.remark";
import { remarkExampleToMarkdown } from "./plugins/example.remark";
import { remarkMermaidToMarkdown } from "./plugins/mermaid.remark";
import { remarkRemoveImports } from "./plugins/remove-imports.remark";
import { remarkStepsToMarkdown } from "./plugins/steps.remark";
import { remarkTabsToMarkdown } from "./plugins/tabs.remark";
import { remarkTopicSwitcherToMarkdown } from "./plugins/topic-switcher.remark";
import { remarkTypeTableToMarkdown } from "./plugins/type-table.remark";

/**
 * Default remark plugins for MDX → Markdown conversion for agent/LLM docs.
 * Order matters: imports are stripped first, then components are flattened
 * into markdown equivalents.
 */
export const defaultRemarkPlugins = [
  remarkRemoveImports,
  remarkResolveDocPlaceholders,
  remarkCalloutToMarkdown,
  remarkCardsToMarkdown,
  remarkMermaidToMarkdown,
  remarkCommandTabsToMarkdown,
  remarkStepsToMarkdown,
  remarkTabsToMarkdown,
  remarkTypeTableToMarkdown,
  remarkAccordionToMarkdown,
  remarkTopicSwitcherToMarkdown,
  remarkExampleToMarkdown,
] as const;
