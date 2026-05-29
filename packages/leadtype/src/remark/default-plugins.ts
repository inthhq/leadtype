/**
 * The built-in remark plugin set, split by scheduling phase.
 *
 * `defaultRemarkPlugins` keeps its historical order (resolve plugins first,
 * then component flatteners). The split exports let the custom-flattener
 * sub-pipeline reuse exactly the flatten-phase plugins, and let phase tagging
 * live in one place. See `internal/remark-phase.ts` for how phases are ordered.
 */

import { tagPhase } from "../internal/remark-phase";
import { remarkAccordionToMarkdown } from "./plugins/accordion.remark";
import { remarkAudienceToMarkdown } from "./plugins/audience.remark";
import { remarkCalloutToMarkdown } from "./plugins/callout.remark";
import { remarkCardsToMarkdown } from "./plugins/cards.remark";
import { remarkCommandTabsToMarkdown } from "./plugins/command-tabs.remark";
import { remarkDetailsToMarkdown } from "./plugins/details.remark";
import { remarkResolveDocPlaceholders } from "./plugins/doc-placeholders.remark";
import { remarkExampleToMarkdown } from "./plugins/example.remark";
import { remarkFileTreeToMarkdown } from "./plugins/file-tree.remark";
import { remarkInclude } from "./plugins/include.remark";
import { remarkMermaidToMarkdown } from "./plugins/mermaid.remark";
import { remarkPromptToMarkdown } from "./plugins/prompt.remark";
import { remarkRemoveImports } from "./plugins/remove-imports.remark";
import { remarkRemoveJsxComments } from "./plugins/remove-jsx-comments.remark";
import { remarkSectionToMarkdown } from "./plugins/section.remark";
import { remarkStepsToMarkdown } from "./plugins/steps.remark";
import { remarkTabsToMarkdown } from "./plugins/tabs.remark";
import { remarkTopicSwitcherToMarkdown } from "./plugins/topic-switcher.remark";
import { remarkTypeTableToMarkdown } from "./plugins/type-table.remark";

// Resolve-phase plugins run before any flattener: includes are expanded,
// placeholders resolved, imports stripped. `remarkInclude` is optional (users
// prepend it) but is tagged here so it still schedules ahead of flatteners.
tagPhase(remarkInclude, "resolve");
tagPhase(remarkRemoveImports, "resolve");
tagPhase(remarkRemoveJsxComments, "resolve");
tagPhase(remarkResolveDocPlaceholders, "resolve");

const resolvePlugins = [
  remarkRemoveImports,
  remarkRemoveJsxComments,
  remarkResolveDocPlaceholders,
];

/**
 * Built-in component flatteners, in dependency order. Reused verbatim by the
 * `defineComponentFlattener` sub-pipeline to flatten a component's children.
 */
export const builtinFlattenerPlugins = [
  remarkAudienceToMarkdown,
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
  remarkFileTreeToMarkdown,
  remarkPromptToMarkdown,
  remarkExampleToMarkdown,
];

/**
 * Default remark plugins for MDX → Markdown conversion for agent/LLM docs.
 * Order matters: imports are stripped first, then components are flattened
 * into markdown equivalents.
 */
export const defaultRemarkPlugins = [
  ...resolvePlugins,
  ...builtinFlattenerPlugins,
];
