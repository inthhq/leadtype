import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { glob as fg } from "tinyglobby";
import type { Pluggable, PluggableList } from "unified";
import { convertAllMdx } from "../convert";
import { type DocsI18nManifest, normalizeDocsI18nConfig } from "../i18n";
import {
  type DocsPathMount,
  normalizeDocsPath,
  normalizeUrlPrefix,
} from "../internal/docs-url";
import { parseFrontmatter } from "../internal/frontmatter";
import {
  logger,
  setLogFormat,
  setLogStreams,
  setVerbose,
} from "../internal/logger";
import type {
  DocsCollection,
  DocsConfig,
  DocsGroup,
  DocsNavNode,
  ProductInfo,
} from "../llm";
import {
  generateAgentReadabilityArtifacts,
  generateAgentsMd,
  generateLLMFullContextFiles,
  generateLlmsTxt,
  resolveDocsNavigation,
} from "../llm";
import {
  defaultRemarkPlugins,
  remarkInclude,
  remarkTypeTableToMarkdown,
} from "../remark";
import type { GenerateDocsSearchFilesResult } from "../search/node";
import { generateDocsSearchFiles } from "../search/node";
import {
  resolveAllCollections,
  type SyncMode,
  syncCollections,
} from "../sync/sync";

const DEFAULT_DOCS_DIR = "docs";
const DEFAULT_OUT_DIR = "public";
const DOCS_CONFIG_FILENAMES = [
  "docs.config.ts",
  "docs.config.js",
  "docs.config.mjs",
  "docs.config.cjs",
] as const;
const LEADTYPE_CONFIG_FILENAMES = [
  "leadtype.config.ts",
  "leadtype.config.js",
  "leadtype.config.mjs",
  "leadtype.config.cjs",
] as const;
const GROUP_SEPARATOR_PATTERN = /[-_]+/g;
const INFER_GROUPS_READ_BATCH_SIZE = 32;
const TITLE_CASE_PATTERN = /\b\w/g;
const FORMAT_VALUES = new Set(["text", "json"]);
const NAV_SORT_VALUES = new Set(["order", "path", "title"]);

type GenerateFormat = "json" | "text";

export type GenerateArgs = {
  baseUrl?: string;
  bundle: boolean;
  docsDirs: string[];
  enrichGit: boolean;
  exclude: string[];
  format: GenerateFormat;
  help: boolean;
  include: string[];
  name?: string;
  outDir: string;
  srcDir: string;
  summary?: string;
  /**
   * How to ensure remote sources are present before generating. Only used
   * when the loaded config defines `collections`.
   *   - `missing` (default): error if any cache is missing or ref-drifted.
   *   - `auto` (`--sync`): clone missing caches; leave existing ones alone.
   *   - `refresh` (`--refresh`): re-fetch and fast-forward every cache.
   *   - `offline` (`--offline`): never touch the network; error on miss.
   */
  syncMode: SyncMode;
  verbose: boolean;
};

export type GenerateIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

type SourceMirror = {
  cleanup: () => Promise<void>;
  docsDir: string;
  filters: GenerateFilters;
  srcDir: string;
};

type GenerateFilters = {
  exclude: string[];
  include: string[];
};

type GenerateResult = {
  docsDir: string;
  docsDirs: string[];
  files: {
    agentsMd?: string;
    agentReadabilityManifest?: string;
    docsRobotsTxt?: string;
    docsSitemapMd?: string;
    docsSitemapXml?: string;
    i18nManifest?: string;
    docsLlmsTxt?: string;
    llmsFullTxt?: string;
    llmsTxt?: string;
    searchContent?: string;
    searchIndex?: string;
  };
  groups: DocsGroup[];
  nav?: DocsNavNode[];
  filters: GenerateFilters;
  mounts: DocsPathMount[];
  mode: "site" | "bundle";
  outDir: string;
  product: ProductInfo;
  search?: GenerateDocsSearchFilesResult;
  srcDir: string;
};

function createGenerateRemarkPlugins({
  sourceRoot,
  typeTableBasePath,
  typeTableStrict,
}: {
  sourceRoot: string;
  typeTableBasePath?: string;
  typeTableStrict?: boolean;
}): PluggableList {
  const plugins: PluggableList = [remarkInclude];
  for (const plugin of defaultRemarkPlugins) {
    plugins.push(
      plugin === remarkTypeTableToMarkdown
        ? ([
            remarkTypeTableToMarkdown,
            {
              basePath: typeTableBasePath ?? sourceRoot,
              strict: typeTableStrict,
            },
          ] as Pluggable)
        : plugin
    );
  }
  return plugins;
}

export type LoadedDocsConfig = {
  config: DocsConfig;
  path: string;
};

type ResolvedGenerateMetadata = {
  configPath?: string;
  groups: DocsGroup[];
  i18n?: DocsConfig["i18n"];
  nav?: DocsNavNode[];
  product: ProductInfo;
  typeTableBasePath?: string;
  typeTableStrict?: boolean;
};

const GENERATE_USAGE = `leadtype generate — convert MDX and produce site or package-bundle artifacts

Usage:
  leadtype generate [options]

By default, runs in site mode and writes:
  llms.txt, llms-full.txt, docs/*.md, docs/search-index.json,
  docs/sitemap.xml, docs/sitemap.md, docs/robots.txt

With --bundle, runs in package mode and writes:
  AGENTS.md, docs/*.md
  (skips llms.txt, llms-full.txt, and search artifacts — those are website-only)

Options:
  --src <dir>        Source repo/root directory (default: .)
  --docs-dir <dir>   Docs source folder relative to --src (default: docs). Repeat to merge multiple folders.
                     Use <dir>=<url-prefix> to mount a source outside /docs, e.g. changelog=/changelog.
  --out <dir>        Output root directory (default: public)
  --bundle           Bundle mode for npm packages (AGENTS.md + docs/*.md)
  --base-url <url>   Base URL for generated links (site mode)
  --name <name>      Product name for generated index files
  --summary <text>   Product summary for generated index files
  --include <glob>   Include MDX paths matching this docs-root-relative glob
  --exclude <glob>   Exclude MDX paths matching this docs-root-relative glob
  --enrich-git       Add lastModified and lastAuthor from git history
  --sync             Clone missing remote sources before generating (collections mode)
  --refresh          Re-fetch and fast-forward every remote source (collections mode)
  --offline          Fail if any remote source cache is missing or stale; never touch the network
  --format <fmt>     text | json (default: text)
  --json             Alias for --format json
  -v, --verbose      Print per-file progress events to stderr
  -h, --help         Show this help
`;

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function isGenerateFormat(value: string): value is GenerateFormat {
  return FORMAT_VALUES.has(value);
}

export function parseGenerateArgs(argv: string[]): GenerateArgs {
  const args: GenerateArgs = {
    bundle: false,
    docsDirs: [],
    enrichGit: false,
    exclude: [],
    format: "text",
    help: false,
    include: [],
    outDir: DEFAULT_OUT_DIR,
    srcDir: ".",
    syncMode: "missing",
    verbose: false,
  };
  const syncFlags: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--src") {
      args.srcDir = readValue(argv, ++i, "--src");
    } else if (arg === "--docs-dir") {
      args.docsDirs.push(readValue(argv, ++i, "--docs-dir"));
    } else if (arg === "--out") {
      args.outDir = readValue(argv, ++i, "--out");
    } else if (arg === "--base-url") {
      args.baseUrl = readValue(argv, ++i, "--base-url");
    } else if (arg === "--name") {
      args.name = readValue(argv, ++i, "--name");
    } else if (arg === "--summary") {
      args.summary = readValue(argv, ++i, "--summary");
    } else if (arg === "--include") {
      args.include.push(readValue(argv, ++i, "--include"));
    } else if (arg === "--exclude") {
      args.exclude.push(readValue(argv, ++i, "--exclude"));
    } else if (arg === "--enrich-git") {
      args.enrichGit = true;
    } else if (arg === "--bundle") {
      args.bundle = true;
    } else if (arg === "--sync") {
      syncFlags.push(arg);
      args.syncMode = "auto";
    } else if (arg === "--refresh") {
      syncFlags.push(arg);
      args.syncMode = "refresh";
    } else if (arg === "--offline") {
      syncFlags.push(arg);
      args.syncMode = "offline";
    } else if (arg === "--format") {
      const value = readValue(argv, ++i, "--format");
      if (!isGenerateFormat(value)) {
        throw new Error(`--format must be text|json, got ${value}`);
      }
      args.format = value;
    } else if (arg === "--json") {
      args.format = "json";
    } else if (arg === "--verbose" || arg === "-v") {
      args.verbose = true;
    } else if (arg) {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  const distinctSyncFlags = [...new Set(syncFlags)];
  if (distinctSyncFlags.length > 1) {
    throw new Error(
      `${distinctSyncFlags.join(" and ")} are mutually exclusive`
    );
  }

  return args;
}

function titleizeGroup(slug: string): string {
  return slug
    .replace(GROUP_SEPARATOR_PATTERN, " ")
    .replace(TITLE_CASE_PATTERN, (match) => match.toUpperCase());
}

function normalizeGroupValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

async function inferGroups(docsDir: string): Promise<DocsGroup[]> {
  const files = await fg("**/*.mdx", {
    absolute: true,
    cwd: docsDir,
    onlyFiles: true,
  });
  const slugs = new Set<string>();

  for (
    let index = 0;
    index < files.length;
    index += INFER_GROUPS_READ_BATCH_SIZE
  ) {
    const batch = files.slice(index, index + INFER_GROUPS_READ_BATCH_SIZE);
    const groupArrays = await Promise.all(
      batch.map(async (file) => {
        const raw = await readFile(file, "utf8");
        const parsed = parseFrontmatter(raw);
        return normalizeGroupValues(parsed.data.group);
      })
    );

    for (const groups of groupArrays) {
      for (const slug of groups) {
        const trimmed = slug.trim();
        if (trimmed.length > 0) {
          slugs.add(trimmed);
        }
      }
    }
  }

  return Array.from(slugs)
    .sort((left, right) => left.localeCompare(right))
    .map((slug) => ({
      slug,
      title: titleizeGroup(slug),
    }));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateProductInfo(value: unknown): ProductInfo | undefined {
  if (!isPlainRecord(value)) {
    return;
  }
  if (typeof value.name !== "string" || typeof value.summary !== "string") {
    return;
  }
  return value as ProductInfo;
}

function validateDocsGroups(value: unknown): DocsGroup[] | undefined {
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

function validateDocsNav(value: unknown): DocsNavNode[] | undefined {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    return;
  }
  for (const node of value) {
    if (!isPlainRecord(node) || typeof node.title !== "string") {
      return;
    }
    if (node.slug !== undefined && typeof node.slug !== "string") {
      return;
    }
    if (
      node.description !== undefined &&
      typeof node.description !== "string"
    ) {
      return;
    }
    if (node.base !== undefined && typeof node.base !== "string") {
      return;
    }
    if (node.pages !== undefined && !Array.isArray(node.pages)) {
      return;
    }
    if (Array.isArray(node.pages)) {
      for (const page of node.pages) {
        if (typeof page === "string") {
          continue;
        }
        if (!isPlainRecord(page) || typeof page.include !== "string") {
          return;
        }
        if (
          page.exclude !== undefined &&
          !(typeof page.exclude === "string" || isStringArray(page.exclude))
        ) {
          return;
        }
        if (
          page.sort !== undefined &&
          !(
            isStringArray(page.sort) &&
            page.sort.every((sortKey) => NAV_SORT_VALUES.has(sortKey))
          )
        ) {
          return;
        }
        if (page.required !== undefined && typeof page.required !== "boolean") {
          return;
        }
      }
    }
    if (
      node.children !== undefined &&
      validateDocsNav(node.children) === undefined
    ) {
      return;
    }
  }
  return value as DocsNavNode[];
}

function validateCollections(
  value: unknown,
  configPath: string
): Record<string, DocsCollection> | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}" must export "collections" as an object map`
    );
  }
  const out: Record<string, DocsCollection> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isPlainRecord(entry)) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" must be an object`
      );
    }
    if (typeof entry.dir !== "string" || entry.dir.length === 0) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" must set "dir" to a non-empty string`
      );
    }
    if (
      entry.repository !== undefined &&
      typeof entry.repository !== "string"
    ) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" repository must be a string`
      );
    }
    // Guard against args that would be parsed as git options when spawned
    // (e.g. a `repository` like `--upload-pack=…` injecting flags).
    if (
      typeof entry.repository === "string" &&
      entry.repository.startsWith("-")
    ) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" repository must not begin with "-"`
      );
    }
    if (entry.ref !== undefined && typeof entry.ref !== "string") {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" ref must be a string`
      );
    }
    if (typeof entry.ref === "string" && entry.ref.startsWith("-")) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" ref must not begin with "-"`
      );
    }
    if (entry.prefix !== undefined && typeof entry.prefix !== "string") {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" prefix must be a string`
      );
    }
    if (
      entry.groups !== undefined &&
      validateDocsGroups(entry.groups) === undefined
    ) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" groups must be an array of { slug, title } entries`
      );
    }
    if (entry.nav !== undefined && validateDocsNav(entry.nav) === undefined) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" nav must be an array of navigation nodes`
      );
    }
    if (entry.include !== undefined && !isStringArray(entry.include)) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" include must be an array of glob strings`
      );
    }
    if (entry.exclude !== undefined && !isStringArray(entry.exclude)) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" exclude must be an array of glob strings`
      );
    }
    out[key] = entry as DocsCollection;
  }
  return out;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function validateDocsConfig(value: unknown, configPath: string): DocsConfig {
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}" must export an object`);
  }
  const product = validateProductInfo(value.product);
  if (!product) {
    throw new Error(
      `docs config at "${configPath}" must export product.name and product.summary`
    );
  }

  const collections = validateCollections(value.collections, configPath);
  const hasGroups = value.groups !== undefined;
  const hasNav = value.nav !== undefined;

  if (collections && hasGroups) {
    throw new Error(
      `docs config at "${configPath}" sets both "groups" and "collections". Move groups into the relevant collection(s) — top-level groups is for the single-collection shape only.`
    );
  }
  if (collections && hasNav) {
    throw new Error(
      `docs config at "${configPath}" sets both "nav" and "collections". Move nav into the relevant collection(s) — top-level nav is for the single-collection shape only.`
    );
  }

  let groups: DocsGroup[] | undefined;
  let nav: DocsNavNode[] | undefined;
  if (collections === undefined) {
    groups = validateDocsGroups(value.groups);
    nav = validateDocsNav(value.nav);
    if (!(groups || nav)) {
      throw new Error(
        `docs config at "${configPath}" must export groups or nav as an array (or define collections)`
      );
    }
    if (hasGroups && !groups) {
      throw new Error(
        `docs config at "${configPath}" must export groups as an array of { slug, title } entries`
      );
    }
    if (hasNav && !nav) {
      throw new Error(
        `docs config at "${configPath}" must export nav as an array of navigation nodes`
      );
    }
  }

  return {
    ...(collections ? { collections } : {}),
    ...(groups ? { groups } : {}),
    ...(nav ? { nav } : {}),
    ...(value.i18n === undefined
      ? {}
      : { i18n: value.i18n as DocsConfig["i18n"] }),
    product,
    typeTableBasePath:
      typeof value.typeTableBasePath === "string"
        ? value.typeTableBasePath
        : undefined,
    typeTableStrict:
      typeof value.typeTableStrict === "boolean"
        ? value.typeTableStrict
        : undefined,
  };
}

async function importConfigModule(configPath: string): Promise<unknown> {
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

async function loadDocsConfigFromDir(
  dir: string,
  filenames: readonly string[]
): Promise<LoadedDocsConfig | null> {
  const configPath = filenames
    .map((filename) => path.join(dir, filename))
    .find((candidate) => existsSync(candidate));

  if (!configPath) {
    return null;
  }

  try {
    const imported = await importConfigModule(configPath);
    return {
      config: validateDocsConfig(imported, configPath),
      path: configPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to load docs config at "${configPath}": ${message}`
    );
  }
}

/**
 * Look for `leadtype.config.{ts,js,mjs,cjs}` in the given directory.
 * Used by the sync CLI; for `generate`, prefer {@link loadDocsConfig}.
 */
export async function loadLeadtypeConfig(
  cwd: string
): Promise<LoadedDocsConfig | null> {
  return loadDocsConfigFromDir(cwd, LEADTYPE_CONFIG_FILENAMES);
}

/**
 * Locate and load the docs config. Lookup order:
 *   1. `leadtype.config.{ts,js,mjs,cjs}` at `cwd` (project root).
 *   2. `docs.config.{ts,js,mjs,cjs}` in each `docsDir` (legacy).
 *
 * The new `leadtype.config.*` filename is opt-in to project-level config;
 * the per-docs-dir `docs.config.*` lookup stays the same as before.
 */
async function loadDocsConfig(opts: {
  cwd?: string;
  docsDirs: string[];
}): Promise<LoadedDocsConfig | null> {
  if (opts.cwd) {
    const projectConfig = await loadDocsConfigFromDir(
      opts.cwd,
      LEADTYPE_CONFIG_FILENAMES
    );
    if (projectConfig) {
      return projectConfig;
    }
  }
  for (const docsDir of opts.docsDirs) {
    const loaded = await loadDocsConfigFromDir(docsDir, DOCS_CONFIG_FILENAMES);
    if (loaded) {
      return loaded;
    }
  }
  return null;
}

async function readPackageProduct(
  srcDir: string,
  args: GenerateArgs
): Promise<ProductInfo> {
  if (args.name && args.summary) {
    return {
      name: args.name,
      summary: args.summary,
    };
  }

  const packageJsonPath = path.join(srcDir, "package.json");
  let packageData: Record<string, unknown> = {};
  if (existsSync(packageJsonPath)) {
    packageData = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<
      string,
      unknown
    >;
  }

  const name =
    args.name ?? (typeof packageData.name === "string" ? packageData.name : "");
  const summary =
    args.summary ??
    (typeof packageData.description === "string"
      ? packageData.description
      : "");

  return {
    name: name || "Docs",
    summary: summary || "Generated documentation.",
  };
}

function applyProductOverrides(
  product: ProductInfo,
  args: GenerateArgs
): ProductInfo {
  return {
    ...product,
    name: args.name ?? product.name,
    summary: args.summary ?? product.summary,
  };
}

function mergeCollectionGroups(
  collections: Record<string, DocsCollection>
): DocsGroup[] {
  const merged: DocsGroup[] = [];
  const seen = new Set<string>();
  for (const collection of Object.values(collections)) {
    if (!collection.groups) {
      continue;
    }
    for (const group of collection.groups) {
      if (seen.has(group.slug.toLowerCase())) {
        throw new Error(
          `Group slug "${group.slug}" appears in multiple collections; group slugs must be globally unique across the project.`
        );
      }
      seen.add(group.slug.toLowerCase());
      merged.push(group);
    }
  }
  return merged;
}

function prefixCollectionNavPath(value: string, mountPath: string): string {
  if (!(mountPath && value.startsWith("/"))) {
    return value;
  }
  return `/${normalizeDocsPath(path.join(mountPath, value.replace(/^\/+/, "")))}`;
}

function prefixCollectionNavNode(
  node: DocsNavNode,
  mountPath: string,
  isRoot = true
): DocsNavNode {
  if (!mountPath) {
    return node;
  }
  const base =
    isRoot || node.base?.startsWith("/")
      ? normalizeDocsPath(
          path.join(mountPath, node.base?.replace(/^\/+/, "") ?? "")
        )
      : node.base;
  return {
    ...node,
    ...(base === undefined ? {} : { base }),
    ...(node.pages
      ? {
          pages: node.pages.map((entry) =>
            typeof entry === "string"
              ? prefixCollectionNavPath(entry, mountPath)
              : {
                  ...entry,
                  include: prefixCollectionNavPath(entry.include, mountPath),
                  ...(entry.exclude === undefined
                    ? {}
                    : {
                        exclude: Array.isArray(entry.exclude)
                          ? entry.exclude.map((exclude) =>
                              prefixCollectionNavPath(exclude, mountPath)
                            )
                          : prefixCollectionNavPath(entry.exclude, mountPath),
                      }),
                }
          ),
        }
      : {}),
    ...(node.children
      ? {
          children: node.children.map((child) =>
            prefixCollectionNavNode(child, mountPath, false)
          ),
        }
      : {}),
  };
}

function mergeCollectionNav(
  collections: Record<string, DocsCollection>,
  sources: ResolvedDocsSource[]
): DocsNavNode[] {
  const nav: DocsNavNode[] = [];
  const sourcesByKey = new Map(sources.map((source) => [source.input, source]));
  for (const [key, collection] of Object.entries(collections)) {
    if (!collection.nav) {
      continue;
    }
    const source = sourcesByKey.get(key);
    for (const node of collection.nav) {
      nav.push(prefixCollectionNavNode(node, source?.mountPath ?? ""));
    }
  }
  return nav;
}

function resolveGenerateMetadata(
  srcDir: string,
  loaded: LoadedDocsConfig | null,
  args: GenerateArgs,
  docsSources: ResolvedDocsSource[]
): Promise<ResolvedGenerateMetadata> {
  if (loaded) {
    const collectionGroups = loaded.config.collections
      ? mergeCollectionGroups(loaded.config.collections)
      : undefined;
    const collectionNav = loaded.config.collections
      ? mergeCollectionNav(loaded.config.collections, docsSources)
      : undefined;
    return Promise.resolve({
      configPath: loaded.path,
      groups: collectionGroups ?? loaded.config.groups ?? [],
      i18n: loaded.config.i18n,
      nav:
        collectionNav && collectionNav.length > 0
          ? collectionNav
          : loaded.config.nav,
      product: applyProductOverrides(loaded.config.product, args),
      typeTableBasePath: loaded.config.typeTableBasePath
        ? path.resolve(srcDir, loaded.config.typeTableBasePath)
        : undefined,
      typeTableStrict: loaded.config.typeTableStrict,
    });
  }
  return readPackageProduct(srcDir, args).then((product) => ({
    groups: [],
    product,
  }));
}

type ResolvedDocsSource = {
  docsDir: string;
  input: string;
  mountPath: string;
  urlPrefix: string;
  /**
   * Per-source filters from a `DocsCollection.{include,exclude}`. Globs are
   * interpreted relative to the source's `docsDir`. Combined with the global
   * CLI `--include`/`--exclude` filters during staging.
   */
  filters?: GenerateFilters;
};

function normalizeDocsSourceInput(input: string): string {
  return path.normalize(input).replace(/[/\\]+$/, "");
}

function parseDocsSourceInput(input: string): {
  docsDir: string;
  urlPrefix?: string;
} {
  const separatorIndex = input.indexOf("=");
  if (separatorIndex === -1) {
    return { docsDir: input };
  }
  const docsDir = input.slice(0, separatorIndex);
  const urlPrefix = input.slice(separatorIndex + 1);
  if (!(docsDir.trim() && urlPrefix.trim())) {
    throw new Error(
      `Invalid --docs-dir value "${input}". Use <dir> or <dir>=<url-prefix>.`
    );
  }
  if (normalizeUrlPrefix(urlPrefix) === "/") {
    throw new Error(
      `Invalid --docs-dir value "${input}". URL prefix must not be the site root.`
    );
  }
  return { docsDir, urlPrefix };
}

function resolveDocsSources(
  srcDir: string,
  docsDirs: string[]
): ResolvedDocsSource[] {
  const parsedInputs = docsDirs.map(parseDocsSourceInput);
  const normalizedInputs = parsedInputs.map((entry) => ({
    input: normalizeDocsSourceInput(entry.docsDir),
    urlPrefix: entry.urlPrefix
      ? normalizeUrlPrefix(entry.urlPrefix)
      : undefined,
  }));
  const mountPaths = new Set<string>();
  return normalizedInputs.map(({ input, urlPrefix }, index) => {
    const docsDir = path.resolve(srcDir, input);
    const mountPath =
      index === 0 ? "" : normalizeDocsPath(path.basename(input || docsDir));
    if (mountPath) {
      const mountKey = mountPath.toLowerCase();
      if (mountPaths.has(mountKey)) {
        throw new Error(
          `Multiple docs sources resolve to the same mount path "${mountPath}". Use distinct source folder names.`
        );
      }
      mountPaths.add(mountKey);
    }
    const resolvedUrlPrefix =
      urlPrefix ?? (mountPath ? `/docs/${mountPath}` : "/docs");
    return { docsDir, input, mountPath, urlPrefix: resolvedUrlPrefix };
  });
}

function sourceMounts(sources: ResolvedDocsSource[]): DocsPathMount[] {
  return sources.map((source) => ({
    pathPrefix: source.mountPath,
    urlPrefix: source.urlPrefix,
  }));
}

const DEFAULT_DOCS_URL_PREFIX = "/docs";
const NESTED_DOCS_PREFIX = `${DEFAULT_DOCS_URL_PREFIX}/`;

function pathPrefixForUrlPrefix(urlPrefix: string): string {
  if (urlPrefix === DEFAULT_DOCS_URL_PREFIX) {
    return "";
  }
  if (urlPrefix.startsWith(NESTED_DOCS_PREFIX)) {
    return urlPrefix.slice(NESTED_DOCS_PREFIX.length);
  }
  return urlPrefix.replace(/^\/+/, "");
}

function resolveDocsSourcesFromCollections(
  collections: Record<string, DocsCollection>,
  configDir: string
): ResolvedDocsSource[] {
  const resolved = resolveAllCollections(collections, configDir);
  const seenUrlPrefixes = new Set<string>();
  const seenMounts = new Set<string>();
  return resolved.map((entry) => {
    if (entry.urlPrefix === "/") {
      throw new Error(
        `collection "${entry.key}" prefix must not be the site root.`
      );
    }
    if (seenUrlPrefixes.has(entry.urlPrefix)) {
      throw new Error(
        `multiple collections share URL prefix "${entry.urlPrefix}".`
      );
    }
    seenUrlPrefixes.add(entry.urlPrefix);
    const mountPath = pathPrefixForUrlPrefix(entry.urlPrefix);
    const mountKey = mountPath.toLowerCase();
    if (mountPath && seenMounts.has(mountKey)) {
      throw new Error(
        `multiple collections resolve to the same staging mount "${mountPath}".`
      );
    }
    seenMounts.add(mountKey);
    const include = entry.collection.include ?? [];
    const exclude = entry.collection.exclude ?? [];
    const filters: GenerateFilters | undefined =
      include.length > 0 || exclude.length > 0
        ? { include, exclude }
        : undefined;
    return {
      docsDir: entry.absoluteDir,
      input: entry.key,
      mountPath,
      urlPrefix: entry.urlPrefix,
      filters,
    };
  });
}

function joinDocsRelativePath(mountPath: string, relativePath: string): string {
  if (!mountPath) {
    return normalizeDocsPath(relativePath);
  }
  return normalizeDocsPath(path.join(mountPath, relativePath));
}

async function copySourceFiles(
  source: ResolvedDocsSource,
  targetDocsDir: string,
  relativePaths?: string[]
): Promise<void> {
  let files: string[];
  if (relativePaths) {
    files = relativePaths;
  } else {
    const include =
      source.filters && source.filters.include.length > 0
        ? source.filters.include
        : ["**/*"];
    const exclude = source.filters?.exclude ?? [];
    files = await fg(include, {
      absolute: false,
      cwd: source.docsDir,
      dot: true,
      // Match the staging-level expansion semantics so bare-directory
      // include entries don't silently fan out to `dir/**`.
      expandDirectories: false,
      ignore: exclude,
      onlyFiles: true,
    });
  }

  await Promise.all(
    files.map(async (file) => {
      const sourcePath = path.join(source.docsDir, file);
      const targetRelativePath = joinDocsRelativePath(source.mountPath, file);
      const targetPath = path.join(targetDocsDir, targetRelativePath);
      if (existsSync(targetPath)) {
        throw new Error(
          `Multiple docs sources produce "${targetRelativePath}". Rename one source file or mount source.`
        );
      }
      await mkdir(path.dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath);
    })
  );
}

async function copyFilteredSourceFiles(
  sources: ResolvedDocsSource[],
  targetDocsDir: string,
  filters: GenerateFilters
): Promise<void> {
  const stagingRoot = await mkdtemp(path.join(tmpdir(), "leadtype-sources-"));
  const stagingDocsDir = path.join(stagingRoot, DEFAULT_DOCS_DIR);
  try {
    for (const source of sources) {
      await copySourceFiles(source, stagingDocsDir);
    }

    const patterns =
      filters.include.length > 0 ? filters.include : ["**/*.mdx"];
    const files = await fg(patterns, {
      absolute: false,
      cwd: stagingDocsDir,
      // tinyglobby expands bare directory names (`build` → `build/**`) by
      // default; fast-glob did not. Disable it so `--include build` still
      // reports "No MDX files matched" instead of silently slurping everything
      // under `build/`.
      expandDirectories: false,
      ignore: filters.exclude,
      onlyFiles: true,
    });
    const mdxFiles = files
      .filter((file) => file.endsWith(".mdx"))
      .sort((left, right) => left.localeCompare(right));

    if (mdxFiles.length === 0) {
      throw new Error(
        "No MDX files matched the provided include/exclude filters"
      );
    }

    await Promise.all(
      mdxFiles.map(async (file) => {
        const sourcePath = path.join(stagingDocsDir, file);
        const targetPath = path.join(targetDocsDir, file);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await cp(sourcePath, targetPath);
      })
    );
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

function expectedDocsUrlPrefix(mountPath: string): string {
  return mountPath ? `/docs/${mountPath}` : "/docs";
}

function outputDirForUrlPrefix(outDir: string, urlPrefix: string): string {
  const relativePath = normalizeDocsPath(urlPrefix).replace(/^\/+/, "");
  return path.join(outDir, relativePath);
}

async function copyMountedMarkdownMirrors(
  outDir: string,
  mounts: DocsPathMount[]
): Promise<void> {
  await Promise.all(
    mounts.map(async (mount) => {
      const pathPrefix = normalizeDocsPath(mount.pathPrefix);
      const urlPrefix = normalizeUrlPrefix(mount.urlPrefix);
      if (urlPrefix === expectedDocsUrlPrefix(pathPrefix)) {
        return;
      }

      const sourceDir = path.join(outDir, DEFAULT_DOCS_DIR, pathPrefix);
      if (!existsSync(sourceDir)) {
        return;
      }
      const targetDir = outputDirForUrlPrefix(outDir, urlPrefix);
      const relativeToOut = path.relative(outDir, targetDir);
      if (
        !relativeToOut ||
        relativeToOut.startsWith("..") ||
        path.isAbsolute(relativeToOut)
      ) {
        throw new Error(
          `Mounted URL prefix "${urlPrefix}" must resolve inside the output directory.`
        );
      }
      await rm(targetDir, { force: true, recursive: true });
      const files = await fg("**/*.md", {
        absolute: false,
        cwd: sourceDir,
        onlyFiles: true,
      });
      await Promise.all(
        files.map(async (file) => {
          const sourcePath = path.join(sourceDir, file);
          const targetPath = path.join(targetDir, file);
          await mkdir(path.dirname(targetPath), { recursive: true });
          await cp(sourcePath, targetPath);
        })
      );
    })
  );
}

async function hasMarkdownFiles(dir: string): Promise<boolean> {
  if (!existsSync(dir)) {
    return false;
  }
  const files = await fg("**/*.md", {
    absolute: false,
    cwd: dir,
    onlyFiles: true,
  });
  return files.length > 0;
}

async function copyDefaultLocaleMarkdownAliases(
  outDir: string,
  defaultLocale: string
): Promise<void> {
  const docsDir = path.join(outDir, DEFAULT_DOCS_DIR);
  const defaultLocaleDir = path.join(docsDir, defaultLocale);
  if (!(await hasMarkdownFiles(defaultLocaleDir))) {
    return;
  }

  const rootMarkdownFiles = await fg("*.md", {
    absolute: false,
    cwd: docsDir,
    onlyFiles: true,
  });
  if (rootMarkdownFiles.length > 0) {
    throw new Error(
      `Ambiguous i18n default-locale output. Use either root docs files or docs/${defaultLocale}/ files for the default locale, not both.`
    );
  }

  const files = await fg("**/*.md", {
    absolute: false,
    cwd: defaultLocaleDir,
    onlyFiles: true,
  });
  await Promise.all(
    files.map(async (file) => {
      const sourcePath = path.join(defaultLocaleDir, file);
      const targetPath = path.join(docsDir, file);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath);
    })
  );
  await rm(defaultLocaleDir, { force: true, recursive: true });
}

function buildI18nManifest(
  config: DocsConfig["i18n"]
): DocsI18nManifest | undefined {
  const i18n = normalizeDocsI18nConfig(config);
  if (!i18n) {
    return;
  }
  return {
    version: 1,
    defaultLocale: i18n.defaultLocale,
    locales: i18n.locales,
    artifacts: i18n.locales.map((locale) => {
      const isDefault = locale.code === i18n.defaultLocale;
      const prefix = isDefault ? "/docs" : `/docs/${locale.code}`;
      return {
        locale: locale.code,
        urlPrefix: prefix,
        llmsTxt: `${prefix}/llms.txt`,
        llmsFullTxt: isDefault ? "/llms-full.txt" : `${prefix}/llms-full.txt`,
        searchIndex: `${prefix}/search-index.json`,
        searchContent: `${prefix}/search-content.json`,
        agentReadabilityManifest: `${prefix}/agent-readability.json`,
        robotsTxt: `${prefix}/robots.txt`,
        sitemapMd: `${prefix}/sitemap.md`,
        sitemapXml: `${prefix}/sitemap.xml`,
      };
    }),
  };
}

async function writeI18nManifest(
  outDir: string,
  manifest: DocsI18nManifest | undefined
): Promise<string | undefined> {
  if (!manifest) {
    return;
  }
  const outputPath = path.join(outDir, DEFAULT_DOCS_DIR, "i18n-manifest.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return outputPath;
}

async function createSourceMirror(
  srcDir: string,
  sources: ResolvedDocsSource[],
  args: GenerateArgs
): Promise<SourceMirror> {
  const filters = {
    exclude: [...args.exclude],
    include: [...args.include],
  };
  const hasFilters = filters.include.length > 0 || filters.exclude.length > 0;

  const isDefaultSingleSource =
    sources.length === 1 &&
    normalizeDocsSourceInput(sources[0]?.input ?? "") === DEFAULT_DOCS_DIR;

  if (isDefaultSingleSource && !hasFilters) {
    const docsDir = sources[0]?.docsDir ?? path.join(srcDir, DEFAULT_DOCS_DIR);
    return {
      cleanup: async () => {
        return;
      },
      docsDir,
      filters,
      srcDir,
    };
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), "leadtype-generate-"));
  const tempDocsDir = path.join(tempRoot, DEFAULT_DOCS_DIR);

  try {
    if (hasFilters) {
      await copyFilteredSourceFiles(sources, tempDocsDir, filters);
    } else {
      for (const source of sources) {
        await copySourceFiles(source, tempDocsDir);
      }
    }
  } catch (error) {
    await rm(tempRoot, { force: true, recursive: true });
    throw error;
  }

  return {
    cleanup: async () => {
      await rm(tempRoot, { force: true, recursive: true });
    },
    docsDir: tempDocsDir,
    filters,
    srcDir: tempRoot,
  };
}

export function getGenerateUsage(): string {
  return GENERATE_USAGE;
}

function renderGenerateResult(result: GenerateResult): string {
  return JSON.stringify(result, null, 2);
}

export async function runGenerateCommand(
  argv: string[],
  io: GenerateIo = { stderr: process.stderr, stdout: process.stdout }
): Promise<number> {
  let args: GenerateArgs;
  try {
    args = parseGenerateArgs(argv);
  } catch (error) {
    io.stderr.write(`${String(error)}\n\n${GENERATE_USAGE}`);
    return 2;
  }

  if (args.help) {
    io.stdout.write(GENERATE_USAGE);
    return 0;
  }

  setLogFormat(args.format === "json" ? "json" : "human");
  setVerbose(args.verbose);
  setLogStreams({ stderr: io.stderr });

  const srcDir = path.resolve(args.srcDir);

  const reportFailure = (message: string): void => {
    if (args.format === "json") {
      logger.error({
        human: { message },
        json: {
          event: "generate.fail",
          fields: {
            error: message,
            filters: { exclude: args.exclude, include: args.include },
          },
        },
      });
    } else {
      io.stderr.write(`leadtype generate: ${message}\n`);
    }
  };

  let loadedConfig: LoadedDocsConfig | null;
  let docsSources: ResolvedDocsSource[];
  try {
    loadedConfig = await loadLeadtypeConfig(srcDir);
    if (loadedConfig?.config.collections) {
      if (args.docsDirs.length > 0) {
        throw new Error(
          `cannot pass --docs-dir when ${loadedConfig.path} defines \`collections\`. Collections fully describe their sources.`
        );
      }
      const configDir = path.dirname(loadedConfig.path);
      await syncCollections({
        mode: args.syncMode,
        configDir,
        collections: loadedConfig.config.collections,
      });
      docsSources = resolveDocsSourcesFromCollections(
        loadedConfig.config.collections,
        configDir
      );
    } else {
      const docsDirsToResolve =
        args.docsDirs.length > 0 ? args.docsDirs : [DEFAULT_DOCS_DIR];
      docsSources = resolveDocsSources(srcDir, docsDirsToResolve);
      if (!loadedConfig) {
        loadedConfig = await loadDocsConfig({
          docsDirs: docsSources.map((source) => source.docsDir),
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportFailure(message);
    return 1;
  }
  const docsDir =
    docsSources[0]?.docsDir ?? path.join(srcDir, DEFAULT_DOCS_DIR);
  const docsDirs = docsSources.map((source) => source.docsDir);
  const mounts = sourceMounts(docsSources);
  const outDir = path.resolve(args.outDir);

  const missingDocsDir = docsDirs.find((candidate) => !existsSync(candidate));
  if (missingDocsDir) {
    if (args.format === "json") {
      logger.error({
        human: { message: `docs directory not found at ${missingDocsDir}` },
        json: {
          event: "generate.docs_not_found",
          fields: { error: "docs directory not found", path: missingDocsDir },
        },
      });
    } else {
      io.stderr.write(
        `leadtype generate: docs directory not found at ${missingDocsDir}\n`
      );
    }
    return 1;
  }

  let sourceMirror: SourceMirror | undefined;
  try {
    const metadata = await resolveGenerateMetadata(
      srcDir,
      loadedConfig,
      args,
      docsSources
    );
    sourceMirror = await createSourceMirror(srcDir, docsSources, args);
    // Collections-mode configs may omit per-collection `groups` and lean on
    // the same frontmatter-discovery path used when no config is present.
    const needsGroupInference =
      !metadata.configPath ||
      Boolean(loadedConfig?.config.collections && metadata.groups.length === 0);
    const { groups, nav, product, typeTableBasePath, typeTableStrict } =
      needsGroupInference
        ? {
            ...metadata,
            groups: await inferGroups(sourceMirror.docsDir),
          }
        : metadata;
    const hasExplicitPathFilters =
      args.include.length > 0 || args.exclude.length > 0;
    const effectiveNav = hasExplicitPathFilters ? undefined : nav;
    const i18n = normalizeDocsI18nConfig(metadata.i18n);
    const i18nManifest = buildI18nManifest(metadata.i18n);

    const localesToValidate = i18n
      ? i18n.locales.map((locale) => locale.code)
      : [undefined];
    for (const locale of localesToValidate) {
      const navigation = await resolveDocsNavigation({
        srcDir: sourceMirror.srcDir,
        groups,
        nav: effectiveNav,
        mounts,
        i18n: metadata.i18n,
        locale,
      });
      const firstUnknownGroup = navigation.unknown[0];
      if (firstUnknownGroup) {
        throw new Error(
          `${firstUnknownGroup.urlPath} declares unknown group "${firstUnknownGroup.slug}"`
        );
      }
    }

    await convertAllMdx({
      srcDir: sourceMirror.docsDir,
      outDir: path.join(outDir, "docs"),
      remarkPlugins: createGenerateRemarkPlugins({
        sourceRoot: srcDir,
        typeTableBasePath,
        typeTableStrict,
      }),
      enrichFrontmatterFromGit: args.enrichGit,
      failOnError: typeTableStrict,
    });

    let result: GenerateResult;
    if (args.bundle) {
      const agents = await generateAgentsMd({
        srcDir: sourceMirror.srcDir,
        outDir,
        product,
        groups,
        nav: effectiveNav,
        i18n: metadata.i18n,
        locale: i18n?.defaultLocale,
      });
      result = {
        docsDir,
        docsDirs,
        files: { agentsMd: agents.outputPath },
        filters: sourceMirror.filters,
        groups,
        ...(effectiveNav ? { nav: effectiveNav } : {}),
        mounts,
        mode: "bundle",
        outDir,
        product,
        srcDir,
      };
    } else {
      if (i18n) {
        await copyDefaultLocaleMarkdownAliases(outDir, i18n.defaultLocale);
      }
      await copyMountedMarkdownMirrors(outDir, mounts);
      const i18nManifestPath = await writeI18nManifest(outDir, i18nManifest);
      await generateLlmsTxt({
        srcDir: sourceMirror.srcDir,
        outDir,
        baseUrl: args.baseUrl,
        product,
        groups,
        nav: effectiveNav,
        mounts,
        i18n: metadata.i18n,
        locale: i18n?.defaultLocale,
      });

      await generateLLMFullContextFiles({
        outDir,
        baseUrl: args.baseUrl,
        product: { name: product.name },
        groups,
        nav: effectiveNav,
        mounts,
        i18n: metadata.i18n,
        locale: i18n?.defaultLocale,
      });

      const search = await generateDocsSearchFiles({
        outDir,
        baseUrl: args.baseUrl,
        mounts,
        i18n: metadata.i18n,
        locale: i18n?.defaultLocale,
      });
      const agentReadability = await generateAgentReadabilityArtifacts({
        outDir,
        baseUrl: args.baseUrl,
        product,
        groups,
        nav: effectiveNav,
        mounts,
        i18n: metadata.i18n,
        locale: i18n?.defaultLocale,
        i18nManifest,
      });

      if (i18n) {
        for (const locale of i18n.locales) {
          if (locale.code === i18n.defaultLocale) {
            continue;
          }
          await generateLlmsTxt({
            srcDir: sourceMirror.srcDir,
            outDir,
            baseUrl: args.baseUrl,
            product,
            groups,
            nav: effectiveNav,
            mounts,
            i18n: metadata.i18n,
            locale: locale.code,
          });
          await generateLLMFullContextFiles({
            outDir,
            baseUrl: args.baseUrl,
            product: { name: product.name },
            groups,
            nav: effectiveNav,
            mounts,
            i18n: metadata.i18n,
            locale: locale.code,
          });
          await generateDocsSearchFiles({
            outDir,
            baseUrl: args.baseUrl,
            mounts,
            i18n: metadata.i18n,
            locale: locale.code,
          });
          await generateAgentReadabilityArtifacts({
            outDir,
            baseUrl: args.baseUrl,
            product,
            groups,
            nav: effectiveNav,
            mounts,
            i18n: metadata.i18n,
            locale: locale.code,
            i18nManifest,
          });
        }
      }

      result = {
        docsDir,
        docsDirs,
        files: {
          agentReadabilityManifest: agentReadability.files.manifest,
          docsRobotsTxt: agentReadability.files.robotsTxt,
          docsSitemapMd: agentReadability.files.sitemapMd,
          docsSitemapXml: agentReadability.files.sitemapXml,
          i18nManifest: i18nManifestPath,
          docsLlmsTxt: path.join(outDir, "docs", "llms.txt"),
          llmsFullTxt: path.join(outDir, "llms-full.txt"),
          llmsTxt: path.join(outDir, "llms.txt"),
          searchContent: search.contentOutputPath,
          searchIndex: search.outputPath,
        },
        filters: sourceMirror.filters,
        groups,
        ...(effectiveNav ? { nav: effectiveNav } : {}),
        mounts,
        mode: "site",
        outDir,
        product,
        search,
        srcDir,
      };
    }

    if (args.format === "json") {
      io.stdout.write(`${renderGenerateResult(result)}\n`);
    }
    logger.info({
      human: { message: `Generated docs pipeline output in ${outDir}` },
      json: {
        event: "generate.done",
        fields: { outDir, mode: result.mode },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportFailure(message);
    return 1;
  } finally {
    await sourceMirror?.cleanup();
  }
  return 0;
}
