/**
 * Config loading and source-owned inheritance — shared by build and runtime.
 *
 * A docs site that pins a source repository inherits that repo's content-owned
 * config: its navigation, frontmatter schema, flatteners, and mounts. If the
 * artifact pipeline and the rendered site each implemented that inheritance,
 * the two would eventually disagree about what a page is called and where it
 * lives — which is the exact failure "one content graph" exists to prevent.
 *
 * So there is one implementation, here, and both sides call it.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluggableList } from "unified";
import type { DocsPathMount } from "../internal/docs-url";
import type {
  DocsCollection,
  DocsGroup,
  DocsNavEntry,
  DocsNavIncludeEntry,
  DocsNavNode,
  DocsNavPageEntry,
  SourceConfigInheritField,
} from "../llm";
import { type ResolvedCollection, resolveAllCollections } from "../sync/sync";
import type { DocsFrontmatterSchema } from "../transformers";

export const DOCS_CONFIG_FILENAMES = [
  "docs.config.ts",
  "docs.config.js",
  "docs.config.mjs",
  "docs.config.cjs",
] as const;

export const LEADTYPE_CONFIG_FILENAMES = [
  "leadtype.config.ts",
  "leadtype.config.js",
  "leadtype.config.mjs",
  "leadtype.config.cjs",
] as const;

const SOURCE_CONFIG_INHERIT_FIELDS = new Set<SourceConfigInheritField>([
  "navigation",
  "groups",
  "frontmatterSchema",
  "flatteners",
]);

const DEFAULT_SOURCE_CONFIG_INHERIT: SourceConfigInheritField[] = [
  "navigation",
  "groups",
  "frontmatterSchema",
  "flatteners",
  "mounts",
];

const NAV_SORT_VALUES = new Set(["order", "path", "title"]);

/** The content-owned fields a docs site may inherit from a source repository. */
export type SourceOwnedConfigFields = {
  flatteners?: PluggableList;
  frontmatterSchema?: DocsFrontmatterSchema;
  groups?: DocsGroup[];
  mounts?: DocsPathMount[];
  navigation?: DocsNavEntry[];
};

export { DEFAULT_SOURCE_CONFIG_INHERIT, SOURCE_CONFIG_INHERIT_FIELDS };

export function isPlainRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function validateDocsMounts(
  value: unknown,
  configPath: string
): DocsPathMount[] | undefined {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`docs config at "${configPath}": mounts must be an array`);
  }
  for (const mount of value) {
    if (
      !isPlainRecord(mount) ||
      typeof mount.pathPrefix !== "string" ||
      typeof mount.urlPrefix !== "string"
    ) {
      throw new Error(
        `docs config at "${configPath}": mounts entries must be { pathPrefix, urlPrefix } objects`
      );
    }
  }
  return value as DocsPathMount[];
}

export function validateDocsGroups(value: unknown): DocsGroup[] | undefined {
  if (!Array.isArray(value)) {
    return;
  }
  for (const group of value) {
    if (!isPlainRecord(group)) {
      return;
    }
    if (typeof group.slug !== "string" || typeof group.title !== "string") {
      return;
    }
    if (
      group.children !== undefined &&
      validateDocsGroups(group.children) === undefined
    ) {
      return;
    }
  }
  return value as DocsGroup[];
}

function validateDocsNavPageEntry(
  value: unknown
): DocsNavPageEntry | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!isPlainRecord(value) || typeof value.include !== "string") {
    return;
  }
  if (
    value.exclude !== undefined &&
    !(typeof value.exclude === "string" || isStringArray(value.exclude))
  ) {
    return;
  }
  if (
    value.sort !== undefined &&
    !(
      isStringArray(value.sort) &&
      value.sort.every((sortKey) => NAV_SORT_VALUES.has(sortKey))
    )
  ) {
    return;
  }
  if (value.required !== undefined && typeof value.required !== "boolean") {
    return;
  }
  return value as DocsNavIncludeEntry;
}

function validateDocsNavNode(value: unknown): DocsNavNode | undefined {
  if (!isPlainRecord(value) || typeof value.title !== "string") {
    return;
  }
  if (value.slug !== undefined && typeof value.slug !== "string") {
    return;
  }
  if (
    value.description !== undefined &&
    typeof value.description !== "string"
  ) {
    return;
  }
  if (value.base !== undefined && typeof value.base !== "string") {
    return;
  }
  if (value.pages !== undefined && !Array.isArray(value.pages)) {
    return;
  }
  if (Array.isArray(value.pages)) {
    for (const page of value.pages) {
      if (validateDocsNavPageEntry(page) === undefined) {
        return;
      }
    }
  }
  if (
    value.children !== undefined &&
    validateDocsNavNodes(value.children) === undefined
  ) {
    return;
  }
  return value as DocsNavNode;
}

function validateDocsNavNodes(value: unknown): DocsNavNode[] | undefined {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    return;
  }
  for (const node of value) {
    if (validateDocsNavNode(node) === undefined) {
      return;
    }
  }
  return value as DocsNavNode[];
}

export function validateDocsNav(value: unknown): DocsNavEntry[] | undefined {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    return;
  }
  for (const entry of value) {
    if (
      validateDocsNavNode(entry) === undefined &&
      validateDocsNavPageEntry(entry) === undefined
    ) {
      return;
    }
  }
  return value as DocsNavEntry[];
}

export function validateSourceOwnedConfigFields(
  value: unknown,
  configPath: string,
  collectionKey: string
): SourceOwnedConfigFields {
  if (!isPlainRecord(value)) {
    throw new Error(`source config at "${configPath}" must export an object`);
  }

  const groups = validateDocsGroups(value.groups);
  const navigation = validateDocsNav(value.navigation);
  const mounts = validateDocsMounts(value.mounts, configPath);
  if (value.groups !== undefined && !groups) {
    throw new Error(
      `source config at "${configPath}" for collection "${collectionKey}" must export groups as an array of { slug, title } entries`
    );
  }
  if (value.navigation !== undefined && !navigation) {
    throw new Error(
      `source config at "${configPath}" for collection "${collectionKey}" must export navigation as an array of page entries or navigation nodes`
    );
  }
  if (value.flatteners !== undefined && !Array.isArray(value.flatteners)) {
    throw new Error(
      `source config at "${configPath}" for collection "${collectionKey}" must export flatteners as an array of remark plugins`
    );
  }

  return {
    ...(groups ? { groups } : {}),
    ...(navigation ? { navigation } : {}),
    ...(mounts ? { mounts } : {}),
    ...(value.frontmatterSchema === undefined
      ? {}
      : {
          frontmatterSchema: value.frontmatterSchema as DocsFrontmatterSchema,
        }),
    ...(value.flatteners === undefined
      ? {}
      : { flatteners: value.flatteners as PluggableList }),
  };
}

export async function importConfigModule(configPath: string): Promise<unknown> {
  if (configPath.endsWith(".ts")) {
    let createJiti: typeof import("jiti").createJiti;
    try {
      ({ createJiti } = await import("jiti"));
    } catch {
      throw new Error(
        `loading TypeScript docs config at "${configPath}" requires the optional peer dependency \`jiti\`. Install it (\`bun add -D jiti\`) or use a .js/.mjs/.cjs config.`
      );
    }
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    return jiti.import(configPath, { default: true });
  }

  const mod = (await import(pathToFileURL(configPath).href)) as {
    default?: unknown;
  };
  return mod.default ?? mod;
}

function resolveSourceConfigPaths(entry: ResolvedCollection): string[] {
  const sourceConfig = entry.collection.inheritConfig;
  if (!sourceConfig) {
    return [];
  }
  const baseDir = entry.absoluteDir;
  if (typeof sourceConfig === "object" && sourceConfig.path) {
    if (path.isAbsolute(sourceConfig.path)) {
      throw new Error(
        `collection "${entry.key}" inheritConfig.path must be relative to the collection dir`
      );
    }
    const configPath = path.resolve(baseDir, sourceConfig.path);
    const relativePath = path.relative(baseDir, configPath);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(
        `collection "${entry.key}" inheritConfig.path must stay inside the collection dir`
      );
    }
    return [configPath];
  }
  return DOCS_CONFIG_FILENAMES.map((filename) => path.join(baseDir, filename));
}

function sourceConfigInheritFields(
  collection: DocsCollection
): SourceConfigInheritField[] {
  const sourceConfig = collection.inheritConfig;
  if (typeof sourceConfig !== "object" || !sourceConfig.inherit) {
    return DEFAULT_SOURCE_CONFIG_INHERIT;
  }
  return sourceConfig.inherit;
}

async function loadCollectionSourceConfig(
  entry: ResolvedCollection
): Promise<SourceOwnedConfigFields> {
  const candidates = resolveSourceConfigPaths(entry);
  const configPath = candidates.find((candidate) => existsSync(candidate));
  if (!configPath) {
    throw new Error(
      `collection "${entry.key}" inheritConfig is enabled but no source config was found. Expected ${candidates.map((candidate) => `"${candidate}"`).join(", ")}.`
    );
  }

  try {
    const imported = await importConfigModule(configPath);
    return validateSourceOwnedConfigFields(imported, configPath, entry.key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to load source config for collection "${entry.key}" at "${configPath}": ${message}`
    );
  }
}

function mergeInheritedSourceConfig(
  collection: DocsCollection,
  sourceConfig: SourceOwnedConfigFields
): DocsCollection {
  const inherit = new Set(sourceConfigInheritFields(collection));
  return {
    ...collection,
    ...(inherit.has("navigation") &&
    collection.navigation === undefined &&
    sourceConfig.navigation !== undefined
      ? { navigation: sourceConfig.navigation }
      : {}),
    ...(inherit.has("groups") &&
    collection.groups === undefined &&
    sourceConfig.groups !== undefined
      ? { groups: sourceConfig.groups }
      : {}),
    ...(inherit.has("frontmatterSchema") &&
    collection.frontmatterSchema === undefined &&
    sourceConfig.frontmatterSchema !== undefined
      ? { frontmatterSchema: sourceConfig.frontmatterSchema }
      : {}),
    ...(inherit.has("flatteners") &&
    collection.flatteners === undefined &&
    sourceConfig.flatteners !== undefined
      ? { flatteners: sourceConfig.flatteners }
      : {}),
    ...(inherit.has("mounts") &&
    collection.mounts === undefined &&
    sourceConfig.mounts !== undefined
      ? { mounts: sourceConfig.mounts }
      : {}),
  };
}

export async function inheritCollectionSourceConfigs(
  collections: Record<string, DocsCollection>,
  configDir: string
): Promise<Record<string, DocsCollection>> {
  const resolved = resolveAllCollections(collections, configDir);
  const next: Record<string, DocsCollection> = { ...collections };
  for (const entry of resolved) {
    if (!entry.collection.inheritConfig) {
      continue;
    }
    const sourceConfig = await loadCollectionSourceConfig(entry);
    next[entry.key] = mergeInheritedSourceConfig(
      entry.collection,
      sourceConfig
    );
  }
  return next;
}
