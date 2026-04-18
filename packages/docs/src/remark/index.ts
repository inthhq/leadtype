/** @biome-ignore lint/performance/noBarrelFile: package entry point */

export * from "./libs";
export { remarkCalloutToMarkdown } from "./plugins/callout.remark";
export { remarkCardsToMarkdown } from "./plugins/cards.remark";
export { remarkInclude } from "./plugins/include.remark";
export { remarkLinkIcon } from "./plugins/link-icon.remark";
export { remarkMermaidToMarkdown } from "./plugins/mermaid.remark";
export { remarkPackageCommandTabsToMarkdown } from "./plugins/package-command-tabs.remark";
export { remarkRemoveImports } from "./plugins/remove-imports.remark";
export { remarkStepsToMarkdown } from "./plugins/steps.remark";
export { remarkTabsToMarkdown } from "./plugins/tabs.remark";
export {
  extractTocFromContent,
  extractTocFromFile,
  type TOCItem,
} from "./plugins/toc-extract.remark";
export {
  extractTypeFromFile,
  remarkTypeTableToMarkdown,
} from "./plugins/type-table.remark";

import { remarkCalloutToMarkdown } from "./plugins/callout.remark";
import { remarkCardsToMarkdown } from "./plugins/cards.remark";
import { remarkMermaidToMarkdown } from "./plugins/mermaid.remark";
import { remarkPackageCommandTabsToMarkdown } from "./plugins/package-command-tabs.remark";
import { remarkRemoveImports } from "./plugins/remove-imports.remark";
import { remarkStepsToMarkdown } from "./plugins/steps.remark";
import { remarkTabsToMarkdown } from "./plugins/tabs.remark";
import { remarkTypeTableToMarkdown } from "./plugins/type-table.remark";

/**
 * Default remark plugins for MDX → Markdown conversion for agent/LLM docs.
 * Order matters: imports are stripped first, then components are flattened
 * into markdown equivalents.
 */
export const defaultRemarkPlugins = [
  remarkRemoveImports,
  remarkCalloutToMarkdown,
  remarkCardsToMarkdown,
  remarkMermaidToMarkdown,
  remarkPackageCommandTabsToMarkdown,
  remarkStepsToMarkdown,
  remarkTabsToMarkdown,
  remarkTypeTableToMarkdown,
] as const;
