import { performance } from "node:perf_hooks";
import type { Root } from "mdast";
import type { Pluggable, PluggableList } from "unified";
import { VFile } from "vfile";
import {
  isMarkdownProfileEnabled,
  recordMarkdownProfile,
} from "../internal/markdown-profile";
import {
  getFlattenerNames,
  sortRemarkPluginsByPhase,
} from "../internal/remark-phase";

export type LeadtypeMdastTransform = (
  tree: Root,
  context: LeadtypeMdastTransformContext,
  file?: VFile
) => Root | undefined | Promise<Root | undefined>;

export type LeadtypeMdastTransformContext = {
  filePath: string;
  value: string;
};

const isTransformer = (value: unknown): value is Transformer<Root, Root> =>
  typeof value === "function";

type Transformer<Tree extends Root, Result extends Root> = (
  tree: Tree,
  file: VFile
) => Result | undefined | Promise<Result | undefined>;

type PreparedMdastTransform = LeadtypeMdastTransform & {
  componentNames?: readonly string[];
  profileName?: string;
};

function pluginName(entry: Pluggable): string {
  const plugin = Array.isArray(entry) ? entry[0] : entry;
  if (typeof plugin !== "function") {
    return "anonymous";
  }
  return plugin.name || "anonymous";
}

function createVFile(context: LeadtypeMdastTransformContext): VFile {
  return new VFile({
    ...(context.filePath ? { path: context.filePath } : {}),
    value: context.value,
  });
}

const toTransform = (entry: Pluggable): LeadtypeMdastTransform | null => {
  const plugin = Array.isArray(entry) ? entry[0] : entry;
  const args = Array.isArray(entry) ? entry.slice(1) : [];
  if (typeof plugin !== "function") {
    return null;
  }

  const pluginFactory = plugin as (...args: unknown[]) => unknown;
  const transformer = pluginFactory(...args);
  if (!isTransformer(transformer)) {
    return null;
  }

  const transform: PreparedMdastTransform = (tree, context, file) =>
    transformer(tree, file ?? createVFile(context));

  const componentNames = getFlattenerNames(entry);
  if (componentNames.length > 0) {
    transform.componentNames = componentNames;
  }
  transform.profileName = pluginName(entry);

  return transform;
};

export function createMdastTransforms(
  plugins: PluggableList = []
): LeadtypeMdastTransform[] {
  const transforms: LeadtypeMdastTransform[] = [];
  for (const entry of sortRemarkPluginsByPhase(plugins)) {
    const transform = toTransform(entry);
    if (transform) {
      transforms.push(transform);
    }
  }
  return transforms;
}

function collectComponentNames(tree: Root): Set<string> {
  const names = new Set<string>();
  const stack: unknown[] = [tree];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const node = value as {
      children?: unknown[];
      name?: unknown;
      type?: unknown;
    };
    if (
      (node.type === "mdxJsxFlowElement" ||
        node.type === "mdxJsxTextElement") &&
      typeof node.name === "string"
    ) {
      names.add(node.name);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        stack.push(child);
      }
    }
  }
  return names;
}

function shouldRunTransform(
  transform: LeadtypeMdastTransform,
  componentNames: Set<string>
): boolean {
  const names = (transform as PreparedMdastTransform).componentNames;
  return !names || names.some((name) => componentNames.has(name));
}

export async function runMdastTransforms(
  tree: Root,
  transforms: readonly LeadtypeMdastTransform[],
  context: LeadtypeMdastTransformContext
): Promise<Root> {
  let current = tree;
  const file = createVFile(context);
  const profileEnabled = isMarkdownProfileEnabled();
  let componentNames = collectComponentNames(current);
  let componentNamesDirty = false;
  for (const transform of transforms) {
    if (componentNamesDirty) {
      const scanStartedAt = profileEnabled ? performance.now() : 0;
      componentNames = collectComponentNames(current);
      if (profileEnabled) {
        recordMarkdownProfile(
          "transform:component-name-scan",
          performance.now() - scanStartedAt
        );
      }
      componentNamesDirty = false;
    }
    if (!shouldRunTransform(transform, componentNames)) {
      continue;
    }
    const transformStartedAt = profileEnabled ? performance.now() : 0;
    const next = await transform(current, context, file);
    if (profileEnabled) {
      recordMarkdownProfile(
        `transform:${(transform as PreparedMdastTransform).profileName ?? "anonymous"}`,
        performance.now() - transformStartedAt
      );
    }
    if (next) {
      current = next;
    }
    componentNamesDirty = true;
  }
  return current;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

export function runMdastTransformsSync(
  tree: Root,
  transforms: readonly LeadtypeMdastTransform[],
  context: LeadtypeMdastTransformContext
): Root {
  let current = tree;
  const file = createVFile(context);
  const profileEnabled = isMarkdownProfileEnabled();
  let componentNames = collectComponentNames(current);
  let componentNamesDirty = false;
  for (const transform of transforms) {
    if (componentNamesDirty) {
      const scanStartedAt = profileEnabled ? performance.now() : 0;
      componentNames = collectComponentNames(current);
      if (profileEnabled) {
        recordMarkdownProfile(
          "transform:component-name-scan",
          performance.now() - scanStartedAt
        );
      }
      componentNamesDirty = false;
    }
    if (!shouldRunTransform(transform, componentNames)) {
      continue;
    }
    const transformStartedAt = profileEnabled ? performance.now() : 0;
    const next = transform(current, context, file);
    if (profileEnabled) {
      recordMarkdownProfile(
        `transform:${(transform as PreparedMdastTransform).profileName ?? "anonymous"}`,
        performance.now() - transformStartedAt
      );
    }
    if (isPromiseLike(next)) {
      throw new Error("Cannot run async markdown transform in sync context.");
    }
    if (next) {
      current = next;
    }
    componentNamesDirty = true;
  }
  return current;
}
