/**
 * The built-in markdown transform set, split by scheduling phase.
 *
 * `defaultMarkdownTransforms` keeps its historical order (resolve plugins first,
 * then component flatteners). The split exports let the custom-flattener
 * sub-pipeline reuse exactly the flatten-phase plugins, and let phase tagging
 * live in one place. See `internal/remark-phase.ts` for how phases are ordered.
 */

import { tagFlattenerNames, tagPhase } from "../internal/remark-phase";
import { remarkResolveDocPlaceholders } from "../remark/plugins/doc-placeholders.remark";
import { remarkInclude as includeMarkdown } from "../remark/plugins/include.remark";
import { remarkRemoveImports } from "../remark/plugins/remove-imports.remark";
import { remarkRemoveJsxComments } from "../remark/plugins/remove-jsx-comments.remark";
import { nativeMarkdownComponentsToMarkdown } from "./component-dispatcher";
import { remarkAccordionToMarkdown } from "./plugins/accordion";
import { remarkAudienceToMarkdown } from "./plugins/audience";
import { remarkCalloutToMarkdown } from "./plugins/callout";
import { remarkCardsToMarkdown } from "./plugins/cards";
import { remarkCommandTabsToMarkdown } from "./plugins/command-tabs";
import { remarkDetailsToMarkdown } from "./plugins/details";
import { remarkExampleToMarkdown } from "./plugins/example";
import { remarkFileTreeToMarkdown } from "./plugins/file-tree";
import { remarkMermaidToMarkdown } from "./plugins/mermaid";
import { remarkPromptToMarkdown } from "./plugins/prompt";
import { remarkSectionToMarkdown } from "./plugins/section";
import { remarkStepsToMarkdown } from "./plugins/steps";
import { remarkTabsToMarkdown } from "./plugins/tabs";
import { remarkTopicSwitcherToMarkdown } from "./plugins/topic-switcher";
import { remarkTypeTableToMarkdown as typeTableToMarkdown } from "./plugins/type-table";

// Resolve-phase plugins run before any flattener: includes are expanded,
// placeholders resolved, imports stripped. `includeMarkdown` is optional (users
// prepend it) but is tagged here so it still schedules ahead of flatteners.
tagPhase(includeMarkdown, "resolve");
tagFlattenerNames(includeMarkdown, ["import", "include-c15t", "include"]);
tagPhase(remarkRemoveImports, "resolve");
tagPhase(remarkRemoveJsxComments, "resolve");
tagPhase(remarkResolveDocPlaceholders, "resolve");
tagFlattenerNames(remarkAudienceToMarkdown, ["Audience"]);
tagFlattenerNames(remarkSectionToMarkdown, ["Section", "section"]);
tagFlattenerNames(remarkCalloutToMarkdown, ["Callout"]);
tagFlattenerNames(remarkCardsToMarkdown, ["Card", "Cards"]);
tagFlattenerNames(remarkDetailsToMarkdown, ["Details", "details"]);
tagFlattenerNames(remarkMermaidToMarkdown, ["Mermaid"]);
tagFlattenerNames(remarkCommandTabsToMarkdown, ["CommandTabs"]);
tagFlattenerNames(remarkTabsToMarkdown, ["Tab", "Tabs"]);
tagFlattenerNames(typeTableToMarkdown, [
  "AutoTypeTable",
  "ExtractedTypeTable",
  "TypeTable",
]);
tagFlattenerNames(remarkAccordionToMarkdown, ["Accordion", "AccordionItem"]);
tagFlattenerNames(remarkTopicSwitcherToMarkdown, ["TopicSwitcher"]);
tagFlattenerNames(remarkFileTreeToMarkdown, ["File", "FileTree", "Folder"]);
tagFlattenerNames(remarkPromptToMarkdown, ["Prompt"]);
tagFlattenerNames(remarkExampleToMarkdown, ["Example"]);

const resolvePlugins = [
  remarkRemoveImports,
  remarkRemoveJsxComments,
  remarkResolveDocPlaceholders,
];

/**
 * Built-in component flatteners, in dependency order. Reused verbatim by the
 * `defineComponentFlattener` sub-pipeline to flatten a component's children.
 */
export const builtinMarkdownFlattenerTransforms = [
  remarkAudienceToMarkdown,
  remarkSectionToMarkdown,
  remarkCalloutToMarkdown,
  remarkCardsToMarkdown,
  remarkDetailsToMarkdown,
  remarkMermaidToMarkdown,
  remarkCommandTabsToMarkdown,
  remarkStepsToMarkdown,
  remarkTabsToMarkdown,
  typeTableToMarkdown,
  remarkAccordionToMarkdown,
  remarkTopicSwitcherToMarkdown,
  remarkFileTreeToMarkdown,
  remarkPromptToMarkdown,
  remarkExampleToMarkdown,
];

export const legacyBuiltinMarkdownFlattenerTransforms =
  builtinMarkdownFlattenerTransforms;

/**
 * Component names the built-in flattener stack recognizes — the tag contract
 * the default pipeline turns into markdown (containers and their children).
 * Keep in sync with `builtinMarkdownFlattenerTransforms`; tooling (the lint
 * `unflattened-component` rule) uses it to spot components that would otherwise
 * leak raw JSX into agent markdown.
 */
export const BUILTIN_FLATTENER_COMPONENT_NAMES = [
  "Accordion",
  "AccordionItem",
  "Audience",
  "Callout",
  "Card",
  "Cards",
  "CommandTabs",
  "Details",
  "Example",
  "ExtractedTypeTable",
  "File",
  "FileTree",
  "Folder",
  "Mermaid",
  "Prompt",
  "Section",
  "Step",
  "Steps",
  "Tab",
  "Tabs",
  "TopicSwitcher",
  "TypeTable",
] as const;

/**
 * Default remark plugins for MDX → Markdown conversion for agent/LLM docs.
 * Order matters: imports are stripped first, then components are flattened
 * into markdown equivalents.
 */
export const defaultMarkdownTransforms = [
  ...resolvePlugins,
  nativeMarkdownComponentsToMarkdown,
];

export const legacyDefaultMarkdownTransforms = [
  ...resolvePlugins,
  ...legacyBuiltinMarkdownFlattenerTransforms,
];

/** @deprecated Use `builtinMarkdownFlattenerTransforms` from `leadtype/markdown`. */
export const builtinFlattenerPlugins = builtinMarkdownFlattenerTransforms;

/** @deprecated Use `defaultMarkdownTransforms` from `leadtype/markdown`. */
export const defaultRemarkPlugins = defaultMarkdownTransforms;
