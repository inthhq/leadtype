/** @biome-ignore lint/performance/noBarrelFile: package entry point */

export { remarkInclude } from "./plugins/include.remark";
export {
  extractTypeFromFile,
  remarkTypeTableToMarkdown,
} from "./plugins/type-table.remark";

import { remarkAccordionToMarkdown } from "./plugins/accordion.remark";
import { remarkCalloutToMarkdown } from "./plugins/callout.remark";
import { remarkCardsToMarkdown } from "./plugins/cards.remark";
import { remarkCommandTabsToMarkdown } from "./plugins/command-tabs.remark";
import { remarkDetailsToMarkdown } from "./plugins/details.remark";
import { remarkResolveDocPlaceholders } from "./plugins/doc-placeholders.remark";
import { remarkExampleToMarkdown } from "./plugins/example.remark";
import { remarkMermaidToMarkdown } from "./plugins/mermaid.remark";
import { remarkRemoveImports } from "./plugins/remove-imports.remark";
import { remarkRemoveJsxComments } from "./plugins/remove-jsx-comments.remark";
import { remarkSectionToMarkdown } from "./plugins/section.remark";
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
  remarkRemoveJsxComments,
  remarkResolveDocPlaceholders,
  remarkSectionToMarkdown,
  remarkCalloutToMarkdown,
  remarkCardsToMarkdown,
  remarkDetailsToMarkdown,
  remarkMermaidToMarkdown,
  remarkCommandTabsToMarkdown,
  remarkStepsToMarkdown,
  remarkTabsToMarkdown,
  remarkTypeTableToMarkdown,
  remarkAccordionToMarkdown,
  remarkTopicSwitcherToMarkdown,
  remarkExampleToMarkdown,
] as const;
