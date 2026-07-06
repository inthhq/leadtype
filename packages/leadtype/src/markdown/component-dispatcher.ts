import { performance } from "node:perf_hooks";
import type { Parent, Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import type { VFile } from "vfile";
import {
  isMarkdownProfileEnabled,
  recordMarkdownProfile,
} from "../internal/markdown-profile";
import type { MdxNode } from "./libs";
import { accordionToMarkdown } from "./plugins/accordion";
import { audienceToMarkdown } from "./plugins/audience";
import { calloutToMarkdown } from "./plugins/callout";
import { cardsToMarkdown } from "./plugins/cards";
import { commandTabsToMarkdown } from "./plugins/command-tabs";
import { detailsToMarkdown } from "./plugins/details";
import { exampleToMarkdown } from "./plugins/example";
import { fileTreeToMarkdown } from "./plugins/file-tree";
import { mermaidToMarkdown } from "./plugins/mermaid";
import {
  apiAuthToMarkdown,
  apiCodeSamplesToMarkdown,
  apiEndpointToMarkdown,
  apiParametersToMarkdown,
  apiRequestBodyToMarkdown,
  apiResponsesToMarkdown,
  apiTryItToMarkdown,
} from "./plugins/openapi";
import { promptToMarkdown } from "./plugins/prompt";
import { sectionToMarkdown } from "./plugins/section";
import { compactStepTree, stepsToMarkdown } from "./plugins/steps";
import { tabsToMarkdown } from "./plugins/tabs";
import { topicSwitcherToMarkdown } from "./plugins/topic-switcher";
import {
  type TypeTableOptions,
  typeTableToMarkdown,
} from "./plugins/type-table";

export type NativeMarkdownDispatcherOptions = {
  typeTable?: Partial<TypeTableOptions>;
};

type Handler = {
  names: readonly string[];
  process: (node: MdxNode, file: VFile) => RootContent[] | undefined;
};

const isParent = (node: unknown): node is Parent =>
  typeof node === "object" &&
  node !== null &&
  "children" in node &&
  Array.isArray((node as { children?: unknown }).children);

const isMdxNode = (node: unknown): node is MdxNode => {
  if (typeof node !== "object" || node === null) {
    return false;
  }
  const type = (node as { type?: unknown }).type;
  return type === "mdxJsxFlowElement" || type === "mdxJsxTextElement";
};

function createHandlers(options: NativeMarkdownDispatcherOptions): Handler[] {
  return [
    { names: ["Audience"], process: audienceToMarkdown },
    { names: ["Section", "section"], process: sectionToMarkdown },
    { names: ["Callout"], process: calloutToMarkdown },
    { names: ["Cards"], process: (node) => cardsToMarkdown(node) },
    { names: ["Details", "details"], process: detailsToMarkdown },
    { names: ["Mermaid"], process: mermaidToMarkdown },
    { names: ["CommandTabs"], process: (node) => commandTabsToMarkdown(node) },
    { names: ["Steps"], process: stepsToMarkdown },
    { names: ["Tabs"], process: tabsToMarkdown },
    {
      names: ["AutoTypeTable", "ExtractedTypeTable", "TypeTable"],
      process: (node, file) =>
        typeTableToMarkdown(node, options.typeTable, file),
    },
    { names: ["Accordion"], process: accordionToMarkdown },
    {
      names: ["TopicSwitcher"],
      process: (node, file) =>
        topicSwitcherToMarkdown(node, String(file.path ?? "")),
    },
    { names: ["FileTree"], process: fileTreeToMarkdown },
    { names: ["Prompt"], process: promptToMarkdown },
    { names: ["Example"], process: exampleToMarkdown },
    { names: ["ApiEndpoint"], process: apiEndpointToMarkdown },
    { names: ["ApiAuth"], process: apiAuthToMarkdown },
    { names: ["ApiParameters"], process: apiParametersToMarkdown },
    { names: ["ApiRequestBody"], process: apiRequestBodyToMarkdown },
    { names: ["ApiCodeSamples"], process: apiCodeSamplesToMarkdown },
    { names: ["ApiResponses"], process: apiResponsesToMarkdown },
    { names: ["ApiTryIt"], process: () => apiTryItToMarkdown() },
  ];
}

function findHandler(
  handlers: readonly Handler[],
  node: MdxNode,
  minPriority: number,
  maxPriority: number
): { handler: Handler; priority: number } | null {
  for (let priority = minPriority; priority < maxPriority; priority += 1) {
    const handler = handlers[priority];
    if (typeof node.name === "string" && handler?.names.includes(node.name)) {
      return { handler, priority };
    }
  }
  return null;
}

function processChildren(
  parent: Parent,
  handlers: readonly Handler[],
  minPriority: number,
  maxPriority: number,
  file: VFile
): void {
  let index = 0;
  while (index < parent.children.length) {
    index = processChild(
      parent,
      index,
      handlers,
      minPriority,
      maxPriority,
      file
    );
  }
}

function processInsertedChildren(
  parent: Parent,
  start: number,
  insertedCount: number,
  handlers: readonly Handler[],
  minPriority: number,
  maxPriority: number,
  file: VFile
): number {
  let index = start;
  let end = start + insertedCount;
  while (index < end) {
    const beforeLength = parent.children.length;
    index = processChild(
      parent,
      index,
      handlers,
      minPriority,
      maxPriority,
      file
    );
    end += parent.children.length - beforeLength;
  }
  return index;
}

function processChild(
  parent: Parent,
  index: number,
  handlers: readonly Handler[],
  minPriority: number,
  maxPriority: number,
  file: VFile
): number {
  const node = parent.children[index];
  if (!node) {
    return index + 1;
  }

  if (!isMdxNode(node)) {
    if (isParent(node)) {
      processChildren(node, handlers, minPriority, maxPriority, file);
    }
    return index + 1;
  }

  const match = findHandler(handlers, node, minPriority, maxPriority);
  if (!match) {
    if (isParent(node)) {
      processChildren(node, handlers, minPriority, maxPriority, file);
    }
    return index + 1;
  }

  if (isParent(node)) {
    processChildren(node, handlers, minPriority, match.priority, file);
  }

  const profileEnabled = isMarkdownProfileEnabled();
  const handlerStartedAt = profileEnabled ? performance.now() : 0;
  const replacement = match.handler.process(node, file);
  if (profileEnabled) {
    recordMarkdownProfile(
      `dispatcher:${match.handler.names[0] ?? "unknown"}`,
      performance.now() - handlerStartedAt
    );
  }
  if (!replacement) {
    if (isParent(node)) {
      processChildren(node, handlers, match.priority + 1, maxPriority, file);
    }
    return index + 1;
  }

  parent.children.splice(index, 1, ...replacement);
  if (replacement.length === 0) {
    return index;
  }

  return processInsertedChildren(
    parent,
    index,
    replacement.length,
    handlers,
    match.priority,
    maxPriority,
    file
  );
}

export function nativeMarkdownComponentsToMarkdown(
  options: NativeMarkdownDispatcherOptions = {}
): Transformer<Root, Root> {
  const handlers = createHandlers(options);
  return (tree, file) => {
    processChildren(tree, handlers, 0, handlers.length, file);
    compactStepTree(tree);
    return tree;
  };
}
