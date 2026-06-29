/**
 * Remark plugin + standalone resolver for include/import MDX elements.
 *
 * Two public surfaces:
 * - `remarkInclude(basePaths?)` — unified plugin that expands `<include>` /
 *   `<import>` tags in an mdast tree (consumed by the agent flattening
 *   pipeline and by the MDX-source preset).
 * - `resolveInclude(specifier, options)` — framework-neutral resolver that
 *   reads + classifies the target file. Consumers calling `createDocsSource()`
 *   use this to load partials at request/build time without going through
 *   remark.
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { Code, Root } from "mdast";
import { mdxToMdast } from "satteri";
import type { Transformer } from "unified";
import { visit } from "unist-util-visit";
import { logger } from "../../internal/logger";
import {
  isMarkdownProfileEnabled,
  recordMarkdownProfile,
} from "../../internal/markdown-profile";

// Regex patterns defined at top level for performance
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const INCLUDE_CACHE_SEPARATOR = "\0";
const INCLUDE_TAG_NAMES = new Set(["import", "include-c15t", "include"]);
const includeContentCache = new Map<string, string>();
const includePathCache = new Map<string, string>();
const includeResolutionInflight = new Map<string, Promise<IncludeResolution>>();

type IncludeCandidate = {
  node: Record<string, unknown>;
  parent: Record<string, unknown> | null;
  parentContainer: Record<string, unknown>[] | null;
  parentIndex: number;
};

// Simple frontmatter parser for our build pipeline
function stripFrontmatterBlock(content: string): { content: string } {
  const match = content.match(FRONTMATTER_REGEX);

  if (!match || match[2] === undefined) {
    return { content };
  }

  return { content: match[2] };
}

function flattenNode(node: Record<string, unknown>): string {
  const children = node.children as Record<string, unknown>[] | undefined;
  const value = node.value as string | undefined;

  if (children) {
    return children
      .map((child: Record<string, unknown>) => flattenNode(child))
      .join("");
  }

  if (value) {
    return value;
  }

  return "";
}

/**
 * Split an include specifier into the file path and optional section anchor.
 *
 * @example
 *   parseIncludeSpecifier("./shared/setup.mdx#install")
 *   // → { file: "./shared/setup.mdx", section: "install" }
 */
export function parseIncludeSpecifier(specifier: string): {
  file: string;
  section?: string;
} {
  const idx = specifier.lastIndexOf("#");
  if (idx === -1) {
    return { file: specifier };
  }

  return {
    file: specifier.slice(0, idx),
    section: specifier.slice(idx + 1),
  };
}

/**
 * Extract a `<section id="...">` subtree from a parsed mdast Root. Returns
 * a Root whose children are the section's children, or null if no matching
 * section exists. Used by `resolveInclude` consumers that want to slice
 * an included document down to one anchor.
 */
export function extractMdxSection(root: Root, sectionId: string): Root | null {
  for (const child of root.children as unknown as Record<string, unknown>[]) {
    const type = child.type as string | undefined;
    const name = (child as Record<string, unknown>).name as string | undefined;
    if (type === "mdxJsxFlowElement" && name === "section") {
      const attributes = (child as Record<string, unknown>).attributes as
        | Record<string, unknown>[]
        | undefined;
      const hasId = attributes?.some(
        (attr) =>
          attr &&
          (attr as Record<string, unknown>).type === "mdxJsxAttribute" &&
          (attr as Record<string, unknown>).name === "id" &&
          (attr as Record<string, unknown>).value === sectionId
      );
      if (hasId) {
        const children = (child as Record<string, unknown>).children as
          | Record<string, unknown>[]
          | undefined;
        return {
          type: "root",
          children: (children ?? []) as unknown as Root["children"],
        };
      }
    }
  }
  return null;
}

// Extract attributes from MDX JSX node
function extractAttributes(
  node: Record<string, unknown>
): Record<string, string | null> {
  const params: Record<string, string | null> = {};

  const attributes = node.attributes as Record<string, unknown>[] | undefined;
  if (attributes) {
    for (const attr of attributes) {
      if (attr.type === "mdxJsxAttribute") {
        const name = attr.name as string;
        const value = attr.value as string | null;
        params[name] = value;
      }
    }
  }

  return params;
}

// Helpers to simplify node replacement
function replaceWithParagraph(
  node: Record<string, unknown>,
  text: string
): void {
  Object.assign(node, {
    type: "paragraph",
    children: [
      {
        type: "text",
        value: text,
      },
    ],
  });
}

function replaceWithRootChildren(
  node: Record<string, unknown>,
  children: unknown[]
): void {
  Object.assign(node, {
    type: "root",
    children,
  });
}

/**
 * Safe parent promotion helper for include transformations.
 *
 * When including content that results in multiple top-level nodes (type: 'root'),
 * we "promote" the replacement up to the parent level if the current node is
 * inside a paragraph. This prevents nested structure issues.
 *
 * Promotion occurs when:
 * - Parent exists AND parent is a paragraph AND replacement.type === 'root'
 *
 * useParent = true means we replace the parent paragraph with the root's children,
 * effectively "flattening" the structure by promoting content up one level.
 *
 * Example:
 * Input:  <p><include> → {type: 'root', children: [{type: 'h1'}, {type: 'p'}]}</p>
 * Output: <p> becomes {type: 'h1'} and sibling {type: 'p'}
 *         (paragraph is replaced with the included content's children)
 */
function isParagraph(node: Record<string, unknown>): boolean {
  return node.type === "paragraph";
}

/** Walk the tree to find the parent array + index of a given node. */
function findContainer(
  tree: Root,
  target: Record<string, unknown>
): { container: Record<string, unknown>[]; index: number } | null {
  const root = tree as unknown as Record<string, unknown>;
  const stack: Record<string, unknown>[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const children = current.children as Record<string, unknown>[] | undefined;
    if (!children) {
      continue;
    }
    for (let i = 0; i < children.length; i++) {
      if (children[i] === target) {
        return { container: children, index: i };
      }
      const child = children[i];
      if (child) {
        stack.push(child);
      }
    }
  }
  return null;
}

function replaceTarget(
  tree: Root,
  node: Record<string, unknown>,
  parent: Record<string, unknown> | null,
  replacement:
    | { type: "root"; children: unknown[] }
    | { type: "paragraph"; children: unknown[] },
  parentLocation?: Pick<IncludeCandidate, "parentContainer" | "parentIndex">
) {
  // If the include lives inside a paragraph but the replacement is a root
  // (multiple top-level nodes), splice the replacement children into the
  // grandparent's children in place of the whole paragraph. Previously we
  // mutated the paragraph into `{ type: "root" }`, producing invalid mdast.
  if (parent && isParagraph(parent) && replacement.type === "root") {
    if (
      parentLocation?.parentContainer?.[parentLocation.parentIndex] === parent
    ) {
      parentLocation.parentContainer.splice(
        parentLocation.parentIndex,
        1,
        ...(replacement.children as Record<string, unknown>[])
      );
      return;
    }

    const found = findContainer(tree, parent);
    if (found) {
      found.container.splice(
        found.index,
        1,
        ...(replacement.children as Record<string, unknown>[])
      );
      return;
    }
    // Couldn't locate grandparent — fall through to the in-place mutation
    // below rather than dropping the included content entirely.
  }
  Object.assign(node, replacement);
}

type ParserLike = { parse: (v: string) => unknown };

const satteriParser: ParserLike = {
  parse: (value: string) =>
    mdxToMdast(value, { features: { frontmatter: false, gfm: true } }),
};

function annotateNestedIncludes(root: Root, baseDir: string | null): void {
  if (!baseDir) {
    return;
  }

  visit(root, (node) => {
    const record = node as unknown as Record<string, unknown>;
    const nodeType = record.type as string | undefined;
    const nodeName = record.name as string | undefined;

    if (
      (nodeType === "mdxJsxFlowElement" || nodeType === "mdxJsxTextElement") &&
      nodeName &&
      INCLUDE_TAG_NAMES.has(nodeName)
    ) {
      const attributes =
        (record.attributes as Record<string, unknown>[] | undefined) ?? [];
      const hasBaseDir = attributes.some(
        (attr) =>
          attr &&
          (attr as Record<string, unknown>).type === "mdxJsxAttribute" &&
          (attr as Record<string, unknown>).name === "baseDir"
      );

      if (!hasBaseDir) {
        attributes.push({
          type: "mdxJsxAttribute",
          name: "baseDir",
          value: baseDir,
        });

        record.attributes = attributes;
      }
    }

    return;
  });
}

function includeContentAsMarkdown(
  node: Record<string, unknown>,
  includeFile: string,
  bodyContent: string,
  options: {
    section?: string;
    parser?: ParserLike;
    baseDir?: string | null;
  }
): void {
  try {
    const chosenParser = options.parser ?? satteriParser;
    let parsed = chosenParser.parse(bodyContent.trim()) as Root;

    if (options.section) {
      const extracted = extractMdxSection(parsed, options.section);
      if (extracted) {
        parsed = extracted;
      } else {
        replaceWithParagraph(
          node,
          `[Error: Could not find section "${options.section}" in ${includeFile}]`
        );
        return;
      }
    }

    // Attach base directory metadata to any nested include/import tags so
    // that subsequent passes can resolve their relative paths correctly.
    annotateNestedIncludes(parsed, options.baseDir ?? null);

    if (parsed.children && parsed.children.length > 0) {
      replaceWithRootChildren(node, parsed.children);
    } else {
      replaceWithParagraph(node, bodyContent.trim());
    }
  } catch {
    replaceWithParagraph(node, bodyContent.trim());
  }
}

export type ResolveIncludePathOptions = {
  /** Directory of the document containing the include reference. */
  fromDir: string;
  /** Fallback base directories searched if the file isn't found relative to fromDir. */
  basePaths?: string[];
  /** Explicit override that pins resolution to this directory (from `baseDir=`). */
  baseDir?: string;
  /** When true, resolve relative to `process.cwd()` (from the `cwd` attribute). */
  cwd?: boolean;
};

/**
 * Resolve an include's file specifier to an absolute path.
 *
 * Resolution order:
 *   1. `baseDir` override, if provided
 *   2. `cwd` flag → resolve from `process.cwd()`
 *   3. relative to `fromDir`
 *   4. each entry in `basePaths`
 *   5. fall back to first `basePaths` entry, else `fromDir`
 */
export function resolveIncludePath(
  file: string,
  options: ResolveIncludePathOptions
): string {
  const { fromDir, basePaths = [], baseDir, cwd } = options;

  if (baseDir) {
    return resolve(baseDir, file);
  }

  if (cwd) {
    return resolve(process.cwd(), file);
  }

  const targetPath = resolve(fromDir, file);
  if (existsSync(targetPath)) {
    return targetPath;
  }

  for (const basePath of basePaths) {
    const candidate = resolve(basePath, file);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  if (basePaths.length > 0 && basePaths[0]) {
    return resolve(basePaths[0], file);
  }

  return resolve(fromDir, file);
}

export type ResolveIncludeOptions = {
  /** Directory of the document containing the include reference. */
  fromDir: string;
  /** Fallback base directories searched if the specifier isn't found relative to fromDir. */
  basePaths?: string[];
  /** Explicit override that pins resolution to this directory (from `baseDir=`). */
  baseDir?: string;
  /** When true, resolve relative to `process.cwd()` (from the `cwd` attribute). */
  cwd?: boolean;
  /** Force code-block rendering with this language even for .md/.mdx files. */
  lang?: string;
};

export type IncludeResolution =
  | {
      kind: "markdown";
      /** File body with any leading frontmatter block removed. */
      content: string;
      /** Absolute path of the resolved file. */
      resolvedPath: string;
      /** Section anchor parsed from the specifier (`#anchor`), if any. */
      section?: string;
    }
  | {
      kind: "code";
      content: string;
      lang: string;
      resolvedPath: string;
    };

function includePathCacheKey(
  file: string,
  options: ResolveIncludePathOptions
): string {
  return [
    file,
    options.fromDir,
    ...(options.basePaths ?? []),
    options.baseDir ?? "",
    options.cwd ? "cwd" : "",
  ].join(INCLUDE_CACHE_SEPARATOR);
}

function resolveIncludePathCached(
  file: string,
  options: ResolveIncludePathOptions
): string {
  const cacheKey = includePathCacheKey(file, options);
  const cached = includePathCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const resolvedPath = resolveIncludePath(file, options);
  includePathCache.set(cacheKey, resolvedPath);
  return resolvedPath;
}

function readIncludeFileCached(resolvedPath: string): string {
  const cached = includeContentCache.get(resolvedPath);
  if (cached) {
    return cached;
  }

  const profileEnabled = isMarkdownProfileEnabled();
  const readStartedAt = profileEnabled ? performance.now() : 0;
  const raw = readFileSync(resolvedPath, "utf8");
  if (profileEnabled) {
    recordMarkdownProfile("include:read", performance.now() - readStartedAt);
  }
  includeContentCache.set(resolvedPath, raw);
  return raw;
}

/**
 * Read the file referenced by an include specifier and classify it as either
 * `markdown` (parse and splice as AST) or `code` (render as a code fence).
 * Pure content resolution — does not touch any mdast.
 *
 * Consumers calling `createDocsSource()` use this directly. The `remarkInclude`
 * plugin wraps this with AST mutation logic.
 *
 * @throws if the resolved file cannot be read.
 */
export async function resolveInclude(
  specifier: string,
  options: ResolveIncludeOptions
): Promise<IncludeResolution> {
  const { file, section } = parseIncludeSpecifier(specifier);
  const resolvedPath = resolveIncludePath(file, {
    fromDir: options.fromDir,
    basePaths: options.basePaths,
    baseDir: options.baseDir,
    cwd: options.cwd,
  });

  const isMarkdownFile = file.endsWith(".md") || file.endsWith(".mdx");
  const asCode = Boolean(options.lang) || !isMarkdownFile;

  const raw = await readFile(resolvedPath, "utf8");

  if (asCode) {
    return {
      kind: "code",
      content: raw,
      lang: options.lang ?? extname(file).slice(1),
      resolvedPath,
    };
  }

  const { content } = stripFrontmatterBlock(raw);
  return {
    kind: "markdown",
    content,
    resolvedPath,
    ...(section ? { section } : {}),
  };
}

async function resolveIncludeInflight(
  specifier: string,
  options: ResolveIncludeOptions
): Promise<IncludeResolution> {
  const { file, section } = parseIncludeSpecifier(specifier);
  const profileEnabled = isMarkdownProfileEnabled();
  const pathStartedAt = profileEnabled ? performance.now() : 0;
  const resolvedPath = resolveIncludePathCached(file, {
    fromDir: options.fromDir,
    basePaths: options.basePaths,
    baseDir: options.baseDir,
    cwd: options.cwd,
  });
  if (profileEnabled) {
    recordMarkdownProfile(
      "include:resolve-path",
      performance.now() - pathStartedAt
    );
  }
  const isMarkdownFile = file.endsWith(".md") || file.endsWith(".mdx");
  const asCode = Boolean(options.lang) || !isMarkdownFile;
  const cacheKey = [
    resolvedPath,
    options.lang ?? "",
    section ?? "",
    asCode ? "code" : "markdown",
  ].join(INCLUDE_CACHE_SEPARATOR);

  const cached = includeResolutionInflight.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const pending = (async () => {
    const raw = readIncludeFileCached(resolvedPath);
    if (asCode) {
      return {
        kind: "code" as const,
        content: raw,
        lang: options.lang ?? extname(file).slice(1),
        resolvedPath,
      };
    }

    const { content } = stripFrontmatterBlock(raw);
    return {
      kind: "markdown" as const,
      content,
      resolvedPath,
      ...(section ? { section } : {}),
    };
  })();

  includeResolutionInflight.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    includeResolutionInflight.delete(cacheKey);
  }
}

// Check if node is an include node
function isIncludeNode(node: Record<string, unknown>): boolean {
  const nodeType = node.type as string;
  const nodeName = node.name as string;

  return (
    (nodeType === "mdxJsxFlowElement" || nodeType === "mdxJsxTextElement") &&
    INCLUDE_TAG_NAMES.has(nodeName)
  );
}

function collectIncludeCandidates(tree: Root): IncludeCandidate[] {
  const candidates: IncludeCandidate[] = [];

  function walk(
    node: Record<string, unknown>,
    container: Record<string, unknown>[] | null,
    index: number
  ): void {
    const children = node.children as Record<string, unknown>[] | undefined;
    if (!children) {
      return;
    }

    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const child = children[childIndex];
      if (!child) {
        continue;
      }
      if (isIncludeNode(child)) {
        candidates.push({
          node: child,
          parent: node,
          parentContainer: container,
          parentIndex: index,
        });
        continue;
      }
      walk(child, children, childIndex);
    }
  }

  walk(tree as unknown as Record<string, unknown>, null, -1);
  return candidates;
}

// Process a single include node — thin AST adapter around resolveInclude.
async function processIncludeNode(
  node: Record<string, unknown>,
  workingDir: string,
  basePaths: string[],
  fileData?: unknown
): Promise<void> {
  const params = extractAttributes(node);
  const specifier = flattenNode(node).trim() || (params.src ?? "").trim();

  if (!specifier) {
    // Misconfigured <include> / <import> — surface instead of silently
    // dropping so authors can find the offending tag in build logs.
    logger.warn({
      human: {
        message:
          "<include> missing specifier (no text content and no src= attribute)",
        hint: `attributes: ${JSON.stringify(params)}`,
      },
      json: {
        event: "include.missing_specifier",
        fields: { attributes: JSON.stringify(params) },
      },
    });
    return;
  }

  const { file: includeFile } = parseIncludeSpecifier(specifier);

  // Register dependency with host compiler (for hot reload / rebuilds). Compiler
  // integrations must see fresh file contents, so they use uncached resolution.
  const compiler = (
    fileData as
      | { _compiler?: { addDependency?: (p: string) => void } }
      | undefined
  )?._compiler;
  const includeResolver = compiler ? resolveInclude : resolveIncludeInflight;
  let resolution: IncludeResolution;
  try {
    const profileEnabled = isMarkdownProfileEnabled();
    const resolveStartedAt = profileEnabled ? performance.now() : 0;
    resolution = await includeResolver(specifier, {
      fromDir: workingDir,
      basePaths,
      baseDir: params.baseDir ?? undefined,
      cwd: "cwd" in params,
      lang: params.lang ?? undefined,
    });
    if (profileEnabled) {
      recordMarkdownProfile(
        "include:resolve",
        performance.now() - resolveStartedAt
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn({
      human: {
        message: `failed to include ${includeFile}: ${errorMessage}`,
      },
      json: {
        event: "include.read_failed",
        fields: { target: includeFile, reason: errorMessage },
      },
    });

    Object.assign(node, {
      type: "paragraph",
      children: [
        {
          type: "text",
          value: `[Error: Could not include file ${includeFile}]`,
        },
      ],
    });
    return;
  }

  compiler?.addDependency?.(resolution.resolvedPath);

  if (resolution.kind === "code") {
    Object.assign(node, {
      type: "code",
      lang: resolution.lang,
      meta: params.meta,
      value: resolution.content,
      data: {},
    } satisfies Code);
    return;
  }

  // Prefer host site's processor to preserve its plugins/transforms
  const ext = resolution.resolvedPath.endsWith(".md") ? "md" : "mdx";
  const hostProcessor = (fileData as Record<string, unknown> | undefined)
    ?._processor as { getProcessor?: (kind: string) => unknown } | undefined;
  const parser = hostProcessor?.getProcessor
    ? hostProcessor.getProcessor(ext)
    : satteriParser;

  const profileEnabled = isMarkdownProfileEnabled();
  const parseStartedAt = profileEnabled ? performance.now() : 0;
  includeContentAsMarkdown(node, includeFile, resolution.content, {
    baseDir: dirname(resolution.resolvedPath),
    section: resolution.section,
    parser: parser as ParserLike,
  });
  if (profileEnabled) {
    recordMarkdownProfile(
      "include:parse-mutate",
      performance.now() - parseStartedAt
    );
  }
}

export function remarkInclude(
  basePaths: string[] = []
): Transformer<Root, Root> {
  return async (tree, file) => {
    const workingDir = file.path ? dirname(file.path) : process.cwd();

    // Support nested includes by repeatedly scanning the tree until no more
    // include/import nodes are found. This is safe because:
    // - Each successful include replaces the original node
    // - We don't introduce new include tags from processed content unless
    //   they are truly nested includes that still need resolution.
    //
    // A hard cap on iterations prevents accidental infinite loops in case of
    // pathological or cyclic content.
    const MAX_PASSES = 10;

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const profileEnabled = isMarkdownProfileEnabled();
      const scanStartedAt = profileEnabled ? performance.now() : 0;
      const candidates = collectIncludeCandidates(tree);
      if (profileEnabled) {
        recordMarkdownProfile(
          "include:scan",
          performance.now() - scanStartedAt
        );
      }

      if (candidates.length === 0) {
        break;
      }

      const processedCandidates = await Promise.all(
        candidates.map(async (candidate) => {
          await processIncludeNode(
            candidate.node,
            workingDir,
            basePaths,
            (file as unknown as { data?: unknown })?.data
          );
          return candidate;
        })
      );

      for (const {
        node: nodeRecord,
        parent: parentRecord,
        parentContainer,
        parentIndex,
      } of processedCandidates) {
        const after = nodeRecord as unknown as {
          type?: string;
          children?: unknown[];
        };

        if (after.type === "root" && Array.isArray(after.children)) {
          replaceTarget(
            tree,
            nodeRecord,
            parentRecord,
            {
              type: "root",
              children: after.children,
            },
            {
              parentContainer,
              parentIndex,
            }
          );
        } else if (
          after.type === "paragraph" &&
          Array.isArray(after.children) &&
          parentRecord &&
          isParagraph(parentRecord)
        ) {
          // Avoid nested <p><p>...</p></p> by promoting the included
          // paragraph's children to the parent level.
          replaceTarget(
            tree,
            nodeRecord,
            parentRecord,
            {
              type: "root",
              children: after.children,
            },
            {
              parentContainer,
              parentIndex,
            }
          );
        }
      }
    }
  };
}
