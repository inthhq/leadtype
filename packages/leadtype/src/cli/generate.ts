import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { glob as fg } from "tinyglobby";
import type { Pluggable, PluggableList } from "unified";
import { convertAllMdx } from "../convert";
import { type DocsFeedConfig, generateFeedArtifacts } from "../feed";
import { type DocsI18nManifest, normalizeDocsI18nConfig } from "../i18n";
import {
  copyFileAtomic,
  sweepLeakedTempFiles,
  writeFileAtomic,
} from "../internal/atomic-fs";
import {
  type DocsPathMount,
  normalizeBaseUrl,
  normalizeDocsPath,
  normalizeUrlPrefix,
} from "../internal/docs-url";
import { parseFrontmatter } from "../internal/frontmatter";
import {
  acquireGenerateLock,
  type GenerateLock,
} from "../internal/generate-lock";
import {
  logger,
  setLogFormat,
  setLogStreams,
  setVerbose,
} from "../internal/logger";
import type {
  DocsCollection,
  DocsConfig,
  DocsFrontmatterSchema,
  DocsGroup,
  DocsLlmsConfig,
  DocsNavEntry,
  DocsNavIncludeEntry,
  DocsNavNode,
  DocsNavPageEntry,
  LlmsProductInfo,
  OrganizationInfo,
  ProductInfo,
  RenderSiteJsonLdOptions,
  SourceConfigInheritField,
} from "../llm";
import {
  generateAgentReadabilityArtifacts,
  generateAgentsMd,
  generateLLMFullContextFiles,
  generateLlmsTxt,
  generateSkillArtifacts,
  resolveAgentInputs,
  resolveDocsNavigation,
} from "../llm";
import {
  defaultMarkdownTransforms,
  includeMarkdown,
  nativeMarkdownComponentsToMarkdown,
} from "../markdown";
import {
  generateMcpServerCard,
  MCP_SERVER_CARD_PATH,
  resolveMcpEndpoint,
} from "../mcp/card";
import { DEFAULT_DOCS_TOOLS, DOCS_TOOL_NAMES } from "../mcp/tools";
import {
  DEFAULT_NLWEB_ASK_PATH,
  generateNlwebArtifacts,
  NLWEB_SCHEMA_MAP_PATH,
} from "../nlweb/artifacts";
import {
  type DocsOpenApiConfig,
  normalizeOpenApiConfig,
  validateDocsOpenApiConfig,
  writeOpenApiPages,
} from "../openapi";
import type { GenerateDocsSearchFilesResult } from "../search/node";
import { generateDocsSearchFiles } from "../search/node";
import {
  type ResolvedCollection,
  resolveAllCollections,
  type SyncMode,
  syncCollections,
} from "../sync/sync";
import type { DocsTransformer } from "../transformers";

const DEFAULT_DOCS_DIR = "docs";
const DEFAULT_OUT_DIR = "public";
const DOCS_CONFIG_FILENAMES = [
  "docs.config.ts",
  "docs.config.js",
  "docs.config.mjs",
  "docs.config.cjs",
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
const FEED_FORMAT_VALUES = new Set(["rss", "atom"]);
const MCP_FLAG_DEPRECATION_MESSAGE =
  "--mcp is deprecated as a generate shortcut and will be removed in the next major version";
const MCP_FLAG_DEPRECATION_HINT =
  "set agents.mcp.enabled in docs.config.ts instead; --mcp remains as a compatibility override for now";
const ENRICH_GIT_FLAG_DEPRECATION_MESSAGE =
  "--enrich-git is deprecated because git enrichment now runs by default";
const ENRICH_GIT_FLAG_DEPRECATION_HINT =
  "remove the flag from generate scripts; enrichment is best-effort and is skipped when git metadata is unavailable";

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

function resolveFeedBaseUrl(baseUrl?: string): string {
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  if (baseUrl?.trim() || !isLocalBaseUrl(resolvedBaseUrl)) {
    return resolvedBaseUrl;
  }

  throw new Error(
    "configured feeds require --base-url or a deployment URL env var so RSS and Atom links are absolute"
  );
}

type GenerateFormat = "json" | "text";

export type GenerateArgs = {
  baseUrl?: string;
  bundle: boolean;
  /**
   * Deprecated bundle-mode shortcut. Prefer `agents.mcp.enabled` in config;
   * while this flag exists, it explicitly emits `search-index.json` +
   * `agent-readability.json` for `leadtype mcp --package <name>`.
   */
  mcp: boolean;
  docsDirs: string[];
  /**
   * Generate defaults this to true. Git metadata is best-effort: no `.git`,
   * shallow history, untracked files, or missing git simply skip enrichment.
   */
  enrichGit: boolean;
  /** True only when the deprecated `--enrich-git` flag was explicitly passed. */
  enrichGitFlag: boolean;
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
  gitSourcePaths?: Map<string, string>;
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
    apiCatalog?: string;
    robotsTxt?: string;
    sitemapMd?: string;
    sitemapXml?: string;
    i18nManifest?: string;
    docsLlmsTxt?: string;
    llmsFullTxt?: string;
    llmsTxt?: string;
    feeds?: Record<string, { rss?: string; atom?: string }>;
    searchContent?: string;
    searchIndex?: string;
    wellKnownLlmsTxt?: string;
    skillMd?: string;
    agentSkills?: string;
    mcpServerCard?: string;
    mcpJson?: string;
    mcpWellKnown?: string;
    nlwebSchemaFeed?: string;
    nlwebSchemaMap?: string;
  };
  groups: DocsGroup[];
  nav?: DocsNavEntry[];
  filters: GenerateFilters;
  mounts: DocsPathMount[];
  mode: "site" | "bundle";
  outDir: string;
  product: LlmsProductInfo;
  search?: GenerateDocsSearchFilesResult;
  srcDir: string;
};

function createGenerateMarkdownTransforms({
  sourceRoot,
  typeTableBasePath,
  typeTableStrict,
  flatteners,
}: {
  sourceRoot: string;
  typeTableBasePath?: string;
  typeTableStrict?: boolean;
  flatteners?: PluggableList;
}): PluggableList {
  const plugins: PluggableList = [includeMarkdown];
  for (const plugin of defaultMarkdownTransforms) {
    plugins.push(
      plugin === nativeMarkdownComponentsToMarkdown
        ? ([
            nativeMarkdownComponentsToMarkdown,
            {
              typeTable: {
                basePath: typeTableBasePath ?? sourceRoot,
                strict: typeTableStrict,
              },
            },
          ] as Pluggable)
        : plugin
    );
  }
  // Custom flatteners are appended; convertAllMdx phase-sorts them into the
  // `custom` phase (after resolve, before the built-in flatteners).
  if (flatteners) {
    plugins.push(...flatteners);
  }
  return plugins;
}

export type LoadedDocsConfig = {
  config: DocsConfig;
  path: string;
};

type ResolvedGenerateMetadata = {
  configPath?: string;
  collectionFrontmatterSchemas?: CollectionFrontmatterSchema[];
  frontmatterSchema?: DocsFrontmatterSchema;
  flatteners?: PluggableList;
  groups: DocsGroup[];
  i18n?: DocsConfig["i18n"];
  nav?: DocsNavEntry[];
  product: LlmsProductInfo;
  /** Derived from `product` + `organization`: JSON-LD options for `renderSiteJsonLd`. */
  jsonLd?: RenderSiteJsonLdOptions;
  /** Derived from `organization`: the agent-card `provider`. */
  provider?: { organization: string; url?: string };
  /** Derived from `product.docs`: the agent-card `documentationUrl`. */
  documentationUrl?: string;
  mounts?: DocsPathMount[];
  feeds?: DocsFeedConfig[];
  git?: DocsConfig["git"];
  openapi?: DocsOpenApiConfig;
  transformers?: DocsTransformer[];
  typeTableBasePath?: string;
  typeTableStrict?: boolean;
  agents?: DocsConfig["agents"];
};

type CollectionFrontmatterSchema = {
  filePaths?: string[];
  pathPrefix: string;
  schema: DocsFrontmatterSchema;
};

type SourceOwnedConfigFields = {
  flatteners?: PluggableList;
  frontmatterSchema?: DocsFrontmatterSchema;
  groups?: DocsGroup[];
  mounts?: DocsPathMount[];
  navigation?: DocsNavEntry[];
};

const GENERATE_USAGE = `leadtype generate — convert MDX and produce site or package-bundle artifacts

Usage:
  leadtype generate [options]

By default, runs in site mode and writes:
  llms.txt, llms-full.txt, docs/*.md, docs/search-index.json,
  sitemap.xml, sitemap.md, robots.txt

With --bundle, runs in package mode and writes:
  AGENTS.md, SKILL.md, docs/*.md
  (skips URL-anchored site artifacts like llms.txt, llms-full.txt, sitemap, robots)
  If docs.config.ts sets agents.mcp.enabled, also emits docs/search-index.json
  + docs/agent-readability.json so the tarball can serve a version-matched MCP
  server (leadtype mcp --package). --mcp enables the same artifacts without config.

Options:
  --src <dir>        Source repo/root directory (default: .)
  --docs-dir <dir>   Docs source folder relative to --src (default: docs). Repeat to merge multiple folders.
                     Use <dir>=<url-prefix> to mount a source outside /docs, e.g. changelog=/changelog.
  --out <dir>        Output root directory (default: public)
  --bundle           Bundle mode for npm packages (AGENTS.md + docs/*.md)
  --mcp              Deprecated: bundle-mode shortcut for MCP artifacts. Prefer agents.mcp.enabled in docs.config.ts
  --base-url <url>   Base URL for generated links (site mode)
  --name <name>      Product name for generated index files
  --summary <text>   Product summary for generated index files
  --include <glob>   Include MDX paths matching this docs-root-relative glob
  --exclude <glob>   Exclude MDX paths matching this docs-root-relative glob
  --enrich-git       Deprecated: git enrichment runs by default and skips when git metadata is unavailable
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
    mcp: false,
    docsDirs: [],
    enrichGit: true,
    enrichGitFlag: false,
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
      args.enrichGitFlag = true;
    } else if (arg === "--bundle") {
      args.bundle = true;
    } else if (arg === "--mcp") {
      args.mcp = true;
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

  // `--mcp` only emits artifacts in bundle mode; accepting it in site mode would
  // silently no-op and mislead automation into thinking MCP files were emitted.
  if (args.mcp && !args.bundle) {
    throw new Error(
      "--mcp requires --bundle (MCP artifacts ship in the bundle)"
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

function validateOptionalStringField(
  value: Record<string, unknown>,
  field: string,
  configPath: string
): void {
  if (value[field] !== undefined && typeof value[field] !== "string") {
    throw new Error(
      `docs config at "${configPath}": organization.${field} must be a string`
    );
  }
}

function validateOptionalStringArrayField(
  value: Record<string, unknown>,
  field: string,
  configPath: string
): void {
  const fieldValue = value[field];
  if (
    fieldValue !== undefined &&
    !(
      Array.isArray(fieldValue) &&
      fieldValue.every((item) => typeof item === "string")
    )
  ) {
    throw new Error(
      `docs config at "${configPath}": organization.${field} must be an array of strings`
    );
  }
}

// Reject keys outside `allowed` — these objects are spread verbatim into the
// JSON-LD output, so a typo would silently become an invalid Schema.org property.
function validateKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  fieldPath: string,
  configPath: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `docs config at "${configPath}": ${fieldPath}.${key} is not a supported field ` +
          `(expected one of: ${allowed.join(", ")})`
      );
    }
  }
}

const POSTAL_ADDRESS_FIELDS = [
  "streetAddress",
  "addressLocality",
  "addressRegion",
  "postalCode",
  "addressCountry",
] as const;

function validatePostalAddress(value: unknown, configPath: string): void {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}": organization.address must be an object`
    );
  }
  validateKnownKeys(
    value,
    POSTAL_ADDRESS_FIELDS,
    "organization.address",
    configPath
  );
  for (const field of POSTAL_ADDRESS_FIELDS) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(
        `docs config at "${configPath}": organization.address.${field} must be a string`
      );
    }
  }
  if (POSTAL_ADDRESS_FIELDS.every((field) => value[field] === undefined)) {
    throw new Error(
      `docs config at "${configPath}": organization.address must include at least one field ` +
        `(${POSTAL_ADDRESS_FIELDS.join(", ")})`
    );
  }
}

function validateStringOrStringArray(
  value: unknown,
  fieldPath: string,
  configPath: string
): void {
  if (
    value !== undefined &&
    typeof value !== "string" &&
    !(Array.isArray(value) && value.every((item) => typeof item === "string"))
  ) {
    throw new Error(
      `docs config at "${configPath}": ${fieldPath} must be a string or array of strings`
    );
  }
}

const CONTACT_POINT_FIELDS = [
  "contactType",
  "email",
  "telephone",
  "url",
  "areaServed",
  "availableLanguage",
] as const;

function validateContactPoint(
  value: unknown,
  configPath: string,
  index?: number
): void {
  const fieldPath =
    index === undefined
      ? "organization.contactPoint"
      : `organization.contactPoint[${index}]`;
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}": ${fieldPath} must be an object`
    );
  }
  validateKnownKeys(value, CONTACT_POINT_FIELDS, fieldPath, configPath);
  if (typeof value.contactType !== "string") {
    throw new Error(
      `docs config at "${configPath}": ${fieldPath}.contactType must be a string`
    );
  }
  if (value.email === undefined && value.telephone === undefined) {
    throw new Error(
      `docs config at "${configPath}": ${fieldPath} must include email or telephone`
    );
  }
  for (const field of ["email", "telephone", "url"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(
        `docs config at "${configPath}": ${fieldPath}.${field} must be a string`
      );
    }
  }
  validateStringOrStringArray(
    value.areaServed,
    `${fieldPath}.areaServed`,
    configPath
  );
  validateStringOrStringArray(
    value.availableLanguage,
    `${fieldPath}.availableLanguage`,
    configPath
  );
}

function validateContactPoints(value: unknown, configPath: string): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, contactPoint] of value.entries()) {
      validateContactPoint(contactPoint, configPath, index);
    }
    return;
  }
  validateContactPoint(value, configPath);
}

function validateProductInfo(value: unknown): ProductInfo | undefined {
  if (!isPlainRecord(value)) {
    return;
  }
  if (typeof value.name !== "string" || typeof value.tagline !== "string") {
    return;
  }
  return value as ProductInfo;
}

function validateOrganization(
  value: unknown,
  configPath: string
): OrganizationInfo | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value) || typeof value.name !== "string") {
    throw new Error(
      `docs config at "${configPath}": organization must be an object with a string name`
    );
  }
  if (value.url !== undefined && typeof value.url !== "string") {
    throw new Error(
      `docs config at "${configPath}": organization.url must be a string`
    );
  }
  validateOptionalStringField(value, "email", configPath);
  validateOptionalStringField(value, "logo", configPath);
  validateOptionalStringArrayField(value, "sameAs", configPath);
  validateContactPoints(value.contactPoint, configPath);
  validatePostalAddress(value.address, configPath);
  return value as OrganizationInfo;
}

function validateLlmsConfig(
  value: unknown,
  configPath: string
): DocsLlmsConfig | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}": llms must be an object`);
  }
  if (value.sections !== undefined && !Array.isArray(value.sections)) {
    throw new Error(
      `docs config at "${configPath}": llms.sections must be an array`
    );
  }
  return value as DocsLlmsConfig;
}

function validateAgentEndpoint(
  value: unknown,
  field: string,
  configPath: string
): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(
      `docs config at "${configPath}": ${field} must be a string`
    );
  }
}

function validateAgentsConfig(
  value: unknown,
  configPath: string
): DocsConfig["agents"] | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}": agents must be an object`);
  }
  // The mcp/nlweb endpoints reach resolveMcpEndpoint() and the tool names feed
  // the server card, so malformed values must fail here, not at generate time.
  const mcp = value.mcp;
  if (mcp !== undefined) {
    if (!isPlainRecord(mcp)) {
      throw new Error(
        `docs config at "${configPath}": agents.mcp must be an object`
      );
    }
    validateAgentEndpoint(mcp.endpoint, "agents.mcp.endpoint", configPath);
    if (mcp.icon !== undefined && typeof mcp.icon !== "string") {
      throw new Error(
        `docs config at "${configPath}": agents.mcp.icon must be a string`
      );
    }
    if (mcp.logo !== undefined && typeof mcp.logo !== "string") {
      throw new Error(
        `docs config at "${configPath}": agents.mcp.logo must be a string`
      );
    }
    if (mcp.serverInfo !== undefined) {
      if (!isPlainRecord(mcp.serverInfo)) {
        throw new Error(
          `docs config at "${configPath}": agents.mcp.serverInfo must be an object`
        );
      }
      for (const field of [
        "name",
        "version",
        "description",
        "instructions",
      ] as const) {
        if (
          mcp.serverInfo[field] !== undefined &&
          typeof mcp.serverInfo[field] !== "string"
        ) {
          throw new Error(
            `docs config at "${configPath}": agents.mcp.serverInfo.${field} must be a string`
          );
        }
      }
    }
    if (mcp.tools !== undefined) {
      const allowed = new Set<string>(DOCS_TOOL_NAMES);
      if (
        !Array.isArray(mcp.tools) ||
        mcp.tools.some((tool) => typeof tool !== "string" || !allowed.has(tool))
      ) {
        throw new Error(
          `docs config at "${configPath}": agents.mcp.tools must be an array of ${DOCS_TOOL_NAMES.join(", ")}`
        );
      }
    }
  }
  const nlweb = value.nlweb;
  if (nlweb !== undefined) {
    if (!isPlainRecord(nlweb)) {
      throw new Error(
        `docs config at "${configPath}": agents.nlweb must be an object`
      );
    }
    validateAgentEndpoint(nlweb.endpoint, "agents.nlweb.endpoint", configPath);
  }
  return value as DocsConfig["agents"];
}

function validateDocsMounts(
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

function validateDocsFeeds(
  value: unknown,
  configPath: string
): DocsFeedConfig[] | undefined {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`docs config at "${configPath}": feeds must be an array`);
  }
  const seen = new Set<string>();
  const seenOutputs = new Set<string>();
  for (const feed of value) {
    if (!isPlainRecord(feed)) {
      throw new Error(
        `docs config at "${configPath}": feed entries must be objects`
      );
    }
    if (typeof feed.id !== "string" || feed.id.length === 0) {
      throw new Error(
        `docs config at "${configPath}": feed entries must set a non-empty id`
      );
    }
    if (seen.has(feed.id)) {
      throw new Error(
        `docs config at "${configPath}": duplicate feed id "${feed.id}"`
      );
    }
    seen.add(feed.id);
    if (typeof feed.title !== "string" || feed.title.length === 0) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" must set a non-empty title`
      );
    }
    if (
      feed.description !== undefined &&
      typeof feed.description !== "string"
    ) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" description must be a string`
      );
    }
    if (
      !isPlainRecord(feed.source) ||
      typeof feed.source.urlPrefix !== "string" ||
      !feed.source.urlPrefix.startsWith("/")
    ) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" source.urlPrefix must start with "/"`
      );
    }
    if (!Array.isArray(feed.formats) || feed.formats.length === 0) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" formats must be a non-empty array`
      );
    }
    for (const format of feed.formats) {
      if (typeof format !== "string" || !FEED_FORMAT_VALUES.has(format)) {
        throw new Error(
          `docs config at "${configPath}": feed "${feed.id}" formats must contain only "rss" or "atom"`
        );
      }
    }
    if (!isPlainRecord(feed.output)) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" output must be an object`
      );
    }
    for (const format of feed.formats) {
      const output = feed.output[format];
      if (typeof output !== "string" || !output.startsWith("/")) {
        throw new Error(
          `docs config at "${configPath}": feed "${feed.id}" output.${format} must start with "/"`
        );
      }
      if (!output.endsWith(".xml")) {
        throw new Error(
          `docs config at "${configPath}": feed "${feed.id}" output.${format} must end with ".xml" so feeds cannot overwrite other generated artifacts`
        );
      }
      if (seenOutputs.has(output)) {
        throw new Error(
          `docs config at "${configPath}": feed "${feed.id}" output.${format} "${output}" is already used by another feed output; output paths must be unique`
        );
      }
      seenOutputs.add(output);
    }
    if (
      feed.limit !== undefined &&
      (typeof feed.limit !== "number" ||
        !Number.isInteger(feed.limit) ||
        feed.limit <= 0)
    ) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" limit must be a positive integer`
      );
    }
  }
  return value as DocsFeedConfig[];
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

function validateDocsNav(value: unknown): DocsNavEntry[] | undefined {
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

function validateSourceConfigInheritance(
  value: unknown,
  configPath: string,
  collectionKey: string
): void {
  if (value === undefined || value === true) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}": collection "${collectionKey}" sourceConfig must be true or an object`
    );
  }
  if (
    value.path !== undefined &&
    (typeof value.path !== "string" || value.path.length === 0)
  ) {
    throw new Error(
      `docs config at "${configPath}": collection "${collectionKey}" sourceConfig.path must be a non-empty string`
    );
  }
  if (value.inherit !== undefined) {
    if (!isStringArray(value.inherit)) {
      throw new Error(
        `docs config at "${configPath}": collection "${collectionKey}" sourceConfig.inherit must be an array of supported field names`
      );
    }
    for (const field of value.inherit) {
      if (
        !SOURCE_CONFIG_INHERIT_FIELDS.has(field as SourceConfigInheritField)
      ) {
        throw new Error(
          `docs config at "${configPath}": collection "${collectionKey}" sourceConfig.inherit contains unsupported field "${field}"`
        );
      }
    }
  }
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
    if (entry.sourceConfig !== undefined && entry.repository === undefined) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" sourceConfig is only supported for remote collections`
      );
    }
    validateSourceConfigInheritance(entry.sourceConfig, configPath, key);
    if (
      entry.groups !== undefined &&
      validateDocsGroups(entry.groups) === undefined
    ) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" groups must be an array of { slug, title } entries`
      );
    }
    if (
      entry.navigation !== undefined &&
      validateDocsNav(entry.navigation) === undefined
    ) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" navigation must be an array of page entries or navigation nodes`
      );
    }
    if (entry.mounts !== undefined) {
      validateDocsMounts(entry.mounts, configPath);
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
    if (entry.flatteners !== undefined && !Array.isArray(entry.flatteners)) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" flatteners must be an array of remark plugins`
      );
    }
    out[key] = entry as DocsCollection;
  }
  return out;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function validateGitConfig(
  value: unknown,
  configPath: string
): DocsConfig["git"] | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}": git must be an object`);
  }
  if (
    value.ignoredAuthors !== undefined &&
    !isStringArray(value.ignoredAuthors)
  ) {
    throw new Error(
      `docs config at "${configPath}": git.ignoredAuthors must be an array of strings`
    );
  }
  return {
    ...(value.ignoredAuthors === undefined
      ? {}
      : { ignoredAuthors: value.ignoredAuthors }),
  };
}

function validateDocsConfig(value: unknown, configPath: string): DocsConfig {
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}" must export an object`);
  }
  const product = validateProductInfo(value.product);
  if (!product) {
    throw new Error(
      `docs config at "${configPath}" must export product.name and product.tagline`
    );
  }

  const collections = validateCollections(value.collections, configPath);
  const hasGroups = value.groups !== undefined;
  const hasNav = value.navigation !== undefined;

  if (collections && hasGroups) {
    throw new Error(
      `docs config at "${configPath}" sets both "groups" and "collections". Move groups into the relevant collection(s) — top-level groups is for the single-collection shape only.`
    );
  }
  if (collections && hasNav) {
    throw new Error(
      `docs config at "${configPath}" sets both "navigation" and "collections". Move navigation into the relevant collection(s) — top-level navigation is for the single-collection shape only.`
    );
  }

  let groups: DocsGroup[] | undefined;
  let nav: DocsNavEntry[] | undefined;
  if (collections === undefined) {
    groups = validateDocsGroups(value.groups);
    nav = validateDocsNav(value.navigation);
    if (!(groups || nav)) {
      throw new Error(
        `docs config at "${configPath}" must export groups or navigation as an array (or define collections)`
      );
    }
    if (hasGroups && !groups) {
      throw new Error(
        `docs config at "${configPath}" must export groups as an array of { slug, title } entries`
      );
    }
    if (hasNav && !nav) {
      throw new Error(
        `docs config at "${configPath}" must export navigation as an array of page entries or navigation nodes`
      );
    }
  }

  const organization = validateOrganization(value.organization, configPath);
  const llms = validateLlmsConfig(value.llms, configPath);
  const agents = validateAgentsConfig(value.agents, configPath);
  const mounts = validateDocsMounts(value.mounts, configPath);
  const feeds = validateDocsFeeds(value.feeds, configPath);
  const git = validateGitConfig(value.git, configPath);
  const openapi = validateDocsOpenApiConfig(
    value.openapi,
    `docs config at "${configPath}"`
  );

  if (value.flatteners !== undefined && !Array.isArray(value.flatteners)) {
    throw new Error(
      `docs config at "${configPath}" must export flatteners as an array of remark plugins`
    );
  }

  return {
    ...(collections ? { collections } : {}),
    ...(groups ? { groups } : {}),
    ...(nav ? { navigation: nav } : {}),
    ...(organization ? { organization } : {}),
    ...(llms ? { llms } : {}),
    ...(agents ? { agents } : {}),
    ...(mounts ? { mounts } : {}),
    ...(feeds ? { feeds } : {}),
    ...(git ? { git } : {}),
    ...(openapi ? { openapi } : {}),
    ...(value.frontmatterSchema === undefined
      ? {}
      : {
          frontmatterSchema: value.frontmatterSchema as DocsFrontmatterSchema,
        }),
    ...(value.transformers === undefined
      ? {}
      : { transformers: value.transformers as DocsTransformer[] }),
    ...(value.flatteners === undefined
      ? {}
      : { flatteners: value.flatteners as DocsConfig["flatteners"] }),
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

function validateSourceOwnedConfigFields(
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

function resolveSourceConfigPaths(entry: ResolvedCollection): string[] {
  const sourceConfig = entry.collection.sourceConfig;
  if (!sourceConfig) {
    return [];
  }
  const baseDir = entry.absoluteDir;
  if (sourceConfig !== true && sourceConfig.path) {
    if (path.isAbsolute(sourceConfig.path)) {
      throw new Error(
        `collection "${entry.key}" sourceConfig.path must be relative to the collection dir`
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
        `collection "${entry.key}" sourceConfig.path must stay inside the collection dir`
      );
    }
    return [configPath];
  }
  return DOCS_CONFIG_FILENAMES.map((filename) => path.join(baseDir, filename));
}

function sourceConfigInheritFields(
  collection: DocsCollection
): SourceConfigInheritField[] {
  const sourceConfig = collection.sourceConfig;
  if (!sourceConfig || sourceConfig === true || !sourceConfig.inherit) {
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
      `collection "${entry.key}" sourceConfig enabled but no source config was found. Expected ${candidates.map((candidate) => `"${candidate}"`).join(", ")}.`
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
    collection.schema === undefined &&
    sourceConfig.frontmatterSchema !== undefined
      ? { schema: sourceConfig.frontmatterSchema }
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

async function inheritCollectionSourceConfigs(
  collections: Record<string, DocsCollection>,
  configDir: string
): Promise<Record<string, DocsCollection>> {
  const resolved = resolveAllCollections(collections, configDir);
  const next: Record<string, DocsCollection> = { ...collections };
  for (const entry of resolved) {
    if (!entry.collection.sourceConfig) {
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
      tagline: args.summary,
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
  const tagline =
    args.summary ??
    (typeof packageData.description === "string"
      ? packageData.description
      : "");

  return {
    name: name || "Docs",
    tagline: tagline || "Generated documentation.",
  };
}

function applyProductOverrides(
  product: ProductInfo,
  args: GenerateArgs
): ProductInfo {
  return {
    ...product,
    name: args.name ?? product.name,
    tagline: args.summary ?? product.tagline,
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

function prefixCollectionRootNavPath(value: string, mountPath: string): string {
  if (!mountPath) {
    return value;
  }
  return `/${normalizeDocsPath(path.join(mountPath, value.replace(/^\/+/, "")))}`;
}

function prefixCollectionNavPageEntry(
  entry: DocsNavPageEntry,
  mountPath: string,
  isRoot = false
): DocsNavPageEntry {
  const prefixPath = isRoot
    ? prefixCollectionRootNavPath
    : prefixCollectionNavPath;
  if (typeof entry === "string") {
    return prefixPath(entry, mountPath);
  }
  return {
    ...entry,
    include: prefixPath(entry.include, mountPath),
    ...(entry.exclude === undefined
      ? {}
      : {
          exclude: Array.isArray(entry.exclude)
            ? entry.exclude.map((exclude) => prefixPath(exclude, mountPath))
            : prefixPath(entry.exclude, mountPath),
        }),
  };
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
            prefixCollectionNavPageEntry(entry, mountPath)
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

function isDocsNavNode(entry: DocsNavEntry): entry is DocsNavNode {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "title" in entry &&
    typeof entry.title === "string"
  );
}

function prefixCollectionNavEntry(
  entry: DocsNavEntry,
  mountPath: string
): DocsNavEntry {
  return isDocsNavNode(entry)
    ? prefixCollectionNavNode(entry, mountPath)
    : prefixCollectionNavPageEntry(entry, mountPath, true);
}

function mergeCollectionNav(
  collections: Record<string, DocsCollection>,
  sources: ResolvedDocsSource[]
): DocsNavEntry[] {
  const nav: DocsNavEntry[] = [];
  const sourcesByKey = new Map(sources.map((source) => [source.input, source]));
  for (const [key, collection] of Object.entries(collections)) {
    if (!collection.navigation) {
      continue;
    }
    const source = sourcesByKey.get(key);
    for (const entry of collection.navigation) {
      nav.push(prefixCollectionNavEntry(entry, source?.mountPath ?? ""));
    }
  }
  return nav;
}

async function sourceStagedMdxPaths(
  source: ResolvedDocsSource
): Promise<string[]> {
  const include =
    source.filters && source.filters.include.length > 0
      ? source.filters.include
      : ["**/*.mdx"];
  const exclude = source.filters?.exclude ?? [];
  const files = await fg(include, {
    absolute: false,
    cwd: source.docsDir,
    dot: true,
    expandDirectories: false,
    ignore: exclude,
    onlyFiles: true,
  });
  return files
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => joinDocsRelativePath(source.mountPath, file));
}

async function resolveCollectionFrontmatterSchemas(
  collections: Record<string, DocsCollection>,
  sources: ResolvedDocsSource[]
): Promise<CollectionFrontmatterSchema[]> {
  const schemas: CollectionFrontmatterSchema[] = [];
  const sourcesByKey = new Map(sources.map((source) => [source.input, source]));
  for (const [key, collection] of Object.entries(collections)) {
    if (!collection.schema) {
      continue;
    }
    const source = sourcesByKey.get(key);
    schemas.push({
      filePaths: source ? await sourceStagedMdxPaths(source) : undefined,
      pathPrefix: source?.mountPath ?? "",
      schema: collection.schema,
    });
  }
  return schemas;
}

async function resolveGenerateMetadata(
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
    const collectionFrontmatterSchemas = loaded.config.collections
      ? await resolveCollectionFrontmatterSchemas(
          loaded.config.collections,
          docsSources
        )
      : undefined;
    const flatteners = [
      ...(loaded.config.flatteners ?? []),
      ...(loaded.config.collections
        ? Object.values(loaded.config.collections).flatMap(
            (collection) => collection.flatteners ?? []
          )
        : []),
    ];
    const agentInputs = resolveAgentInputs({
      product: applyProductOverrides(loaded.config.product, args),
      organization: loaded.config.organization,
      llms: loaded.config.llms,
    });
    return {
      configPath: loaded.path,
      collectionFrontmatterSchemas:
        collectionFrontmatterSchemas && collectionFrontmatterSchemas.length > 0
          ? collectionFrontmatterSchemas
          : undefined,
      flatteners: flatteners.length > 0 ? flatteners : undefined,
      frontmatterSchema: loaded.config.frontmatterSchema,
      groups: collectionGroups ?? loaded.config.groups ?? [],
      i18n: loaded.config.i18n,
      nav:
        collectionNav && collectionNav.length > 0
          ? collectionNav
          : loaded.config.navigation,
      mounts: loaded.config.mounts,
      feeds: loaded.config.feeds,
      git: loaded.config.git,
      openapi: loaded.config.openapi,
      ...agentInputs,
      transformers: loaded.config.transformers,
      typeTableBasePath: loaded.config.typeTableBasePath
        ? path.resolve(srcDir, loaded.config.typeTableBasePath)
        : undefined,
      typeTableStrict: loaded.config.typeTableStrict,
      agents: loaded.config.agents,
    };
  }
  return readPackageProduct(srcDir, args).then((product) => ({
    groups: [],
    product: resolveAgentInputs({ product }).product,
  }));
}

type ResolvedDocsSource = {
  docsDir: string;
  input: string;
  mounts?: DocsPathMount[];
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
  return sources.flatMap((source) => [
    {
      pathPrefix: source.mountPath,
      urlPrefix: source.urlPrefix,
    },
    ...(source.mounts ?? []).map((mount) => ({
      pathPrefix: normalizeDocsPath(
        path.join(source.mountPath, mount.pathPrefix)
      ),
      urlPrefix: mount.urlPrefix,
    })),
  ]);
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
      mounts: entry.collection.mounts,
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
  relativePaths?: string[],
  gitSourcePaths?: Map<string, string>
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
      gitSourcePaths?.set(path.resolve(targetPath), sourcePath);
    })
  );
}

async function copyFilteredSourceFiles(
  sources: ResolvedDocsSource[],
  targetDocsDir: string,
  filters: GenerateFilters,
  gitSourcePaths?: Map<string, string>
): Promise<void> {
  const stagingRoot = await mkdtemp(path.join(tmpdir(), "leadtype-sources-"));
  const stagingDocsDir = path.join(stagingRoot, DEFAULT_DOCS_DIR);
  const stagingGitSourcePaths = new Map<string, string>();
  try {
    for (const source of sources) {
      await copySourceFiles(
        source,
        stagingDocsDir,
        undefined,
        stagingGitSourcePaths
      );
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
        gitSourcePaths?.set(
          path.resolve(targetPath),
          stagingGitSourcePaths.get(path.resolve(sourcePath)) ?? sourcePath
        );
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
      // A mount whose urlPrefix resolves inside its own source subtree (e.g.
      // pathPrefix "guides" with urlPrefix "/docs/guides/public") nests
      // targetDir under sourceDir. Exclude the mirror from the source glob so
      // a previous run's mirror output is never re-mirrored into itself.
      const targetRelativeToSource = path.relative(sourceDir, targetDir);
      const targetInsideSource =
        targetRelativeToSource.length > 0 &&
        !targetRelativeToSource.startsWith("..") &&
        !path.isAbsolute(targetRelativeToSource);
      const files = await fg("**/*.md", {
        absolute: false,
        cwd: sourceDir,
        ignore: targetInsideSource
          ? [`${normalizeDocsPath(targetRelativeToSource)}/**`]
          : [],
        onlyFiles: true,
      });
      await Promise.all(
        files.map(async (file) => {
          const sourcePath = path.join(sourceDir, file);
          const targetPath = path.join(targetDir, file);
          await mkdir(path.dirname(targetPath), { recursive: true });
          await copyFileAtomic(sourcePath, targetPath);
        })
      );
      // Prune mirror files whose source pages no longer exist. Pruning after
      // the copy (instead of rm -rf on the whole mirror before it) keeps the
      // mirror readable throughout — a concurrent reader never sees the
      // directory disappear mid-generation.
      const currentFiles = new Set(files);
      const mirroredFiles = await fg("**/*.md", {
        absolute: false,
        cwd: targetDir,
        onlyFiles: true,
      });
      const staleFiles = mirroredFiles.filter(
        (file) => !currentFiles.has(file)
      );
      await Promise.all(
        staleFiles.map((file) =>
          rm(path.join(targetDir, file), { force: true })
        )
      );
      await removeEmptyMirrorDirs(targetDir, staleFiles);
    })
  );
}

/**
 * Remove directories left empty after pruning stale mirror files, walking
 * each pruned file's parent chain up to (but never including) the mirror
 * root. A non-empty directory stops the walk — everything above it is
 * non-empty too.
 */
async function removeEmptyMirrorDirs(
  targetDir: string,
  prunedFiles: string[]
): Promise<void> {
  const parents = new Set(
    prunedFiles.map((file) => path.dirname(path.join(targetDir, file)))
  );
  for (const parent of [...parents].sort(
    (left, right) => right.length - left.length
  )) {
    let current = parent;
    while (current.startsWith(`${targetDir}${path.sep}`)) {
      try {
        await rmdir(current);
      } catch {
        break;
      }
      current = path.dirname(current);
    }
  }
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
      await copyFileAtomic(sourcePath, targetPath);
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
  await writeFileAtomic(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return outputPath;
}

async function createSourceMirror(
  srcDir: string,
  sources: ResolvedDocsSource[],
  args: GenerateArgs,
  forceStaging = false
): Promise<SourceMirror> {
  const filters = {
    exclude: [...args.exclude],
    include: [...args.include],
  };
  const hasFilters = filters.include.length > 0 || filters.exclude.length > 0;

  const isDefaultSingleSource =
    sources.length === 1 &&
    normalizeDocsSourceInput(sources[0]?.input ?? "") === DEFAULT_DOCS_DIR &&
    path.resolve(sources[0]?.docsDir ?? "") ===
      path.resolve(srcDir, DEFAULT_DOCS_DIR);

  if (isDefaultSingleSource && !hasFilters && !forceStaging) {
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
  const gitSourcePaths = new Map<string, string>();

  try {
    if (hasFilters) {
      await copyFilteredSourceFiles(
        sources,
        tempDocsDir,
        filters,
        gitSourcePaths
      );
    } else {
      for (const source of sources) {
        await copySourceFiles(source, tempDocsDir, undefined, gitSourcePaths);
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
    gitSourcePaths,
    srcDir: tempRoot,
  };
}

export function getGenerateUsage(): string {
  return GENERATE_USAGE;
}

function renderGenerateResult(result: GenerateResult): string {
  return JSON.stringify(result, null, 2);
}

const BUNDLE_DOCS_URL = "https://leadtype.dev/docs/package-docs/bundle";

/**
 * The installable npm name for the bundled package. The pointer must reference
 * `node_modules/<name>/AGENTS.md`, so it needs the real package name from the
 * output package's `package.json` — not `product.name`, which is often a human
 * display name ("My library") that wouldn't resolve as a directory.
 */
async function readBundlePackageName(
  outDir: string,
  fallback: string
): Promise<string> {
  const packageJsonPath = path.join(outDir, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const data = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
        name?: unknown;
      };
      if (typeof data.name === "string" && data.name.length > 0) {
        return data.name;
      }
    } catch {
      // Fall through to the product-name fallback on unreadable/invalid JSON.
    }
  }
  return fallback;
}

/**
 * The wiring guidance printed after a successful `--bundle` run. Bundled docs
 * only pay off when an agent actually reads them, and our evals show the root
 * `AGENTS.md` pointer is what makes that reliable — so we surface the exact
 * snippet here instead of leaving it buried in the docs.
 */
function renderBundlePointerGuidance(packageName: string): string {
  return [
    "",
    "Make coding agents read these docs — the highest-leverage setup step.",
    "Add this to your published README so consuming projects point their root",
    "AGENTS.md at the bundle (in our evals this lifts bundle-read from ~29% to",
    "~90–100%):",
    "",
    "  ```md",
    `  When working with the \`${packageName}\` library, read the bundled docs`,
    `  in \`node_modules/${packageName}/AGENTS.md\` first — they're`,
    "  version-matched to the installed package and stay accurate as it updates.",
    "  ```",
    "",
    `  Details: ${BUNDLE_DOCS_URL}`,
    "",
  ].join("\n");
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
  if (args.mcp) {
    logger.warn({
      human: {
        message: MCP_FLAG_DEPRECATION_MESSAGE,
        hint: MCP_FLAG_DEPRECATION_HINT,
      },
      json: {
        event: "generate.deprecated_flag",
        fields: {
          flag: "--mcp",
          hint: MCP_FLAG_DEPRECATION_HINT,
        },
      },
    });
  }
  if (args.enrichGitFlag) {
    logger.warn({
      human: {
        message: ENRICH_GIT_FLAG_DEPRECATION_MESSAGE,
        hint: ENRICH_GIT_FLAG_DEPRECATION_HINT,
      },
      json: {
        event: "generate.deprecated_flag",
        fields: {
          flag: "--enrich-git",
          hint: ENRICH_GIT_FLAG_DEPRECATION_HINT,
        },
      },
    });
  }

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
      const collections = await inheritCollectionSourceConfigs(
        loadedConfig.config.collections,
        configDir
      );
      loadedConfig = {
        ...loadedConfig,
        config: {
          ...loadedConfig.config,
          collections,
        },
      };
      docsSources = resolveDocsSourcesFromCollections(collections, configDir);
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

  // Serialize concurrent generate runs targeting the same outDir (parallel CI
  // task graphs commonly fan out lint/typecheck/build, each regenerating docs).
  // Atomic per-file writes keep individual artifacts readable at all times;
  // the lock keeps whole runs from interleaving their read-back phases.
  let generateLock: GenerateLock | undefined;
  if (process.env.LEADTYPE_NO_LOCK !== "1") {
    try {
      const waitTimeoutMs = Number(process.env.LEADTYPE_LOCK_TIMEOUT_MS);
      generateLock = await acquireGenerateLock(
        outDir,
        Number.isFinite(waitTimeoutMs) && waitTimeoutMs > 0
          ? { waitTimeoutMs }
          : {}
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportFailure(message);
      return 1;
    }
  }

  let sourceMirror: SourceMirror | undefined;
  try {
    if (generateLock) {
      // With the lock held, no other run is in flight — safe to sweep temp
      // files leaked into the output tree by a previous hard-killed run.
      await sweepLeakedTempFiles(outDir);
    }
    const metadata = await resolveGenerateMetadata(
      srcDir,
      loadedConfig,
      args,
      docsSources
    );
    sourceMirror = await createSourceMirror(
      srcDir,
      docsSources,
      args,
      metadata.openapi !== undefined
    );
    const generatedOpenApi =
      metadata.openapi === undefined
        ? { nav: [], pages: [] }
        : await writeOpenApiPages({
            configs: normalizeOpenApiConfig(
              metadata.openapi,
              metadata.configPath ? path.dirname(metadata.configPath) : docsDir
            ),
            docsDir: sourceMirror.docsDir,
          });
    const hasExplicitPathFilters =
      args.include.length > 0 || args.exclude.length > 0;
    // Collections-mode configs may omit per-collection `groups` and lean on
    // the same frontmatter-discovery path used when no config is present.
    // Filtered single-folder runs also disable curated nav, so infer groups
    // when the loaded config only provided `nav`.
    const needsGroupInference =
      !metadata.configPath ||
      Boolean(
        loadedConfig?.config.collections && metadata.groups.length === 0
      ) ||
      (hasExplicitPathFilters && metadata.groups.length === 0);
    const { groups, nav, product, typeTableBasePath, typeTableStrict } =
      needsGroupInference
        ? {
            ...metadata,
            groups: await inferGroups(sourceMirror.docsDir),
          }
        : metadata;
    const bundleMcpEnabled = args.mcp || metadata.agents?.mcp?.enabled === true;
    const effectiveNav = hasExplicitPathFilters
      ? undefined
      : [...(nav ?? []), ...generatedOpenApi.nav];
    const effectiveMounts = [...mounts, ...(metadata.mounts ?? [])];
    const i18n = normalizeDocsI18nConfig(metadata.i18n);
    const i18nManifest = buildI18nManifest(metadata.i18n);
    const gitSourcePaths = sourceMirror.gitSourcePaths;

    const localesToValidate = i18n
      ? i18n.locales.map((locale) => locale.code)
      : [undefined];
    for (const locale of localesToValidate) {
      const navigation = await resolveDocsNavigation({
        srcDir: sourceMirror.srcDir,
        groups,
        nav: effectiveNav,
        mounts: effectiveMounts,
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
      markdownTransforms: createGenerateMarkdownTransforms({
        sourceRoot: srcDir,
        typeTableBasePath,
        typeTableStrict,
        flatteners: metadata.flatteners,
      }),
      enrichFrontmatterFromGit: args.enrichGit,
      failOnError: typeTableStrict,
      frontmatterSchemaByPath: metadata.collectionFrontmatterSchemas,
      frontmatterSchema: metadata.frontmatterSchema,
      ignoredGitAuthors: metadata.git?.ignoredAuthors,
      gitSourcePath: gitSourcePaths
        ? (filePath) => gitSourcePaths.get(path.resolve(filePath)) ?? filePath
        : undefined,
      transformers: metadata.transformers,
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
        transformers: metadata.transformers,
      });
      const bundleFiles: GenerateResult["files"] = {
        agentsMd: agents.outputPath,
      };
      // Bundle MCP artifacts are inferred from docs.config.ts (`agents.mcp.enabled`)
      // or explicitly enabled with --mcp. They are URL-independent: MCP keys on
      // urlPath and reads the .md mirror, so they work without a --base-url.
      if (bundleMcpEnabled) {
        const search = await generateDocsSearchFiles({
          outDir,
          baseUrl: args.baseUrl,
          mounts: effectiveMounts,
          i18n: metadata.i18n,
          locale: i18n?.defaultLocale,
          transformers: metadata.transformers,
        });
        const agentReadability = await generateAgentReadabilityArtifacts({
          outDir,
          baseUrl: args.baseUrl,
          product,
          groups,
          nav: effectiveNav,
          mounts: effectiveMounts,
          i18n: metadata.i18n,
          locale: i18n?.defaultLocale,
          i18nManifest,
          transformers: metadata.transformers,
        });
        bundleFiles.searchIndex = search.outputPath;
        if (search.contentOutputPath) {
          bundleFiles.searchContent = search.contentOutputPath;
        }
        bundleFiles.agentReadabilityManifest = agentReadability.files.manifest;
      }
      // Ship the docs-skill SKILL.md next to AGENTS.md (offline-pointing), unless
      // the author disabled it.
      const bundleSkills = await generateSkillArtifacts({
        outDir,
        // Skill `bodyPath` resolves against the real source root (`--src`), not
        // the temp conversion mirror (which only holds the docs tree).
        srcDir,
        product,
        skills: metadata.agents?.skills,
        mode: "bundle",
        mcpEnabled: bundleMcpEnabled,
      });
      if (bundleSkills.files[0]) {
        bundleFiles.skillMd = bundleSkills.files[0];
      }
      result = {
        docsDir,
        docsDirs,
        files: bundleFiles,
        filters: sourceMirror.filters,
        groups,
        ...(effectiveNav ? { nav: effectiveNav } : {}),
        mounts: effectiveMounts,
        mode: "bundle",
        outDir,
        product,
        srcDir,
      };
    } else {
      const feedBaseUrl =
        metadata.feeds && metadata.feeds.length > 0
          ? resolveFeedBaseUrl(args.baseUrl)
          : undefined;
      if (i18n) {
        await copyDefaultLocaleMarkdownAliases(outDir, i18n.defaultLocale);
      }
      await copyMountedMarkdownMirrors(outDir, effectiveMounts);
      const i18nManifestPath = await writeI18nManifest(outDir, i18nManifest);
      const mcpConfig = metadata.agents?.mcp;
      const mcpEnabled = mcpConfig?.enabled === true;
      const mcpEndpoint = mcpEnabled
        ? resolveMcpEndpoint(args.baseUrl, mcpConfig.endpoint)
        : undefined;
      const nlwebConfig = metadata.agents?.nlweb;
      const nlwebEnabled = nlwebConfig?.enabled === true;
      const askEndpoint = nlwebEnabled
        ? resolveMcpEndpoint(
            args.baseUrl,
            nlwebConfig.endpoint ?? DEFAULT_NLWEB_ASK_PATH
          )
        : undefined;
      await generateLlmsTxt({
        srcDir: sourceMirror.srcDir,
        outDir,
        baseUrl: args.baseUrl,
        product,
        groups,
        nav: effectiveNav,
        mounts: effectiveMounts,
        i18n: metadata.i18n,
        locale: i18n?.defaultLocale,
        transformers: metadata.transformers,
        agentInterfaces: {
          ...(mcpEndpoint
            ? {
                mcpEndpoint,
                mcpServerCardUrl: resolveMcpEndpoint(
                  args.baseUrl,
                  `/${MCP_SERVER_CARD_PATH}`
                ),
                // Same subset the server card advertises, so the two
                // discovery surfaces never disagree about the endpoint.
                mcpTools: [...new Set(mcpConfig?.tools ?? DEFAULT_DOCS_TOOLS)],
              }
            : {}),
          ...(askEndpoint ? { askEndpoint } : {}),
        },
      });

      await generateLLMFullContextFiles({
        outDir,
        baseUrl: args.baseUrl,
        product: { name: product.name },
        groups,
        nav: effectiveNav,
        mounts: effectiveMounts,
        i18n: metadata.i18n,
        locale: i18n?.defaultLocale,
        transformers: metadata.transformers,
      });

      const search = await generateDocsSearchFiles({
        outDir,
        baseUrl: args.baseUrl,
        mounts: effectiveMounts,
        i18n: metadata.i18n,
        locale: i18n?.defaultLocale,
        transformers: metadata.transformers,
      });
      const agentReadability = await generateAgentReadabilityArtifacts({
        outDir,
        baseUrl: args.baseUrl,
        product,
        groups,
        nav: effectiveNav,
        mounts: effectiveMounts,
        i18n: metadata.i18n,
        locale: i18n?.defaultLocale,
        i18nManifest,
        transformers: metadata.transformers,
        robotsPolicy: metadata.agents?.robots?.policy,
        contentSignals: metadata.agents?.robots?.signals,
        ...(nlwebEnabled
          ? { schemamapUrlPath: `/${NLWEB_SCHEMA_MAP_PATH}` }
          : {}),
        jsonLd: metadata.jsonLd,
        seo: metadata.agents?.seo,
      });
      const nlwebArtifacts = nlwebEnabled
        ? await generateNlwebArtifacts({
            outDir,
            baseUrl: args.baseUrl,
            product,
            pages: agentReadability.manifest.pages,
          })
        : undefined;

      // Emit the agent-skills surface (/.well-known/agent-skills + agent-card).
      // Default-on: the auto docs-skill is free and points agents at the docs.
      const siteSkills = await generateSkillArtifacts({
        outDir,
        // Skill `bodyPath` resolves against the real source root (`--src`), not
        // the temp conversion mirror (which only holds the docs tree).
        srcDir,
        baseUrl: args.baseUrl,
        product,
        skills: {
          ...metadata.agents?.skills,
          agentCard: metadata.agents?.agentCard?.enabled,
        },
        mode: "site",
        mcpEnabled,
        mcpEndpoint,
        // Agent-card provider / docs URL derived from `organization` + `product.docs`.
        ...(metadata.provider ? { provider: metadata.provider } : {}),
        ...(metadata.documentationUrl
          ? { documentationUrl: metadata.documentationUrl }
          : {}),
        ...(metadata.agents?.agentCard?.version
          ? { version: metadata.agents.agentCard.version }
          : {}),
      });
      const agentSkillsIndex = siteSkills.files.find((f) =>
        f.endsWith("index.json")
      );
      let mcpServerCard:
        | Awaited<ReturnType<typeof generateMcpServerCard>>
        | undefined;
      if (mcpEnabled) {
        mcpServerCard = await generateMcpServerCard({
          outDir,
          baseUrl: args.baseUrl,
          product,
          config: {
            endpoint: mcpConfig.endpoint,
            icon: mcpConfig.icon,
            logo: mcpConfig.logo,
            serverInfo: mcpConfig.serverInfo,
            authentication: mcpConfig.authentication,
            tools: mcpConfig.tools,
          },
        });
      }

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
            mounts: effectiveMounts,
            i18n: metadata.i18n,
            locale: locale.code,
            transformers: metadata.transformers,
          });
          await generateLLMFullContextFiles({
            outDir,
            baseUrl: args.baseUrl,
            product: { name: product.name },
            groups,
            nav: effectiveNav,
            mounts: effectiveMounts,
            i18n: metadata.i18n,
            locale: locale.code,
            transformers: metadata.transformers,
          });
          await generateDocsSearchFiles({
            outDir,
            baseUrl: args.baseUrl,
            mounts: effectiveMounts,
            i18n: metadata.i18n,
            locale: locale.code,
            transformers: metadata.transformers,
          });
          await generateAgentReadabilityArtifacts({
            outDir,
            baseUrl: args.baseUrl,
            product,
            groups,
            nav: effectiveNav,
            mounts: effectiveMounts,
            i18n: metadata.i18n,
            locale: locale.code,
            i18nManifest,
            transformers: metadata.transformers,
            robotsPolicy: metadata.agents?.robots?.policy,
            contentSignals: metadata.agents?.robots?.signals,
            jsonLd: metadata.jsonLd,
            seo: metadata.agents?.seo,
          });
        }
      }
      const feeds = await generateFeedArtifacts({
        outDir,
        baseUrl: feedBaseUrl,
        author: product.name,
        feeds: metadata.feeds,
        mounts: effectiveMounts,
        i18n: metadata.i18n,
      });

      result = {
        docsDir,
        docsDirs,
        files: {
          agentReadabilityManifest: agentReadability.files.manifest,
          ...(agentReadability.files.apiCatalog
            ? { apiCatalog: agentReadability.files.apiCatalog }
            : {}),
          ...(agentReadability.files.robotsTxt
            ? { robotsTxt: agentReadability.files.robotsTxt }
            : {}),
          ...(agentReadability.files.sitemapMd
            ? { sitemapMd: agentReadability.files.sitemapMd }
            : {}),
          ...(agentReadability.files.sitemapXml
            ? { sitemapXml: agentReadability.files.sitemapXml }
            : {}),
          ...(Object.keys(feeds.files).length > 0
            ? { feeds: feeds.files }
            : {}),
          i18nManifest: i18nManifestPath,
          docsLlmsTxt: path.join(outDir, "docs", "llms.txt"),
          llmsFullTxt: path.join(outDir, "llms-full.txt"),
          llmsTxt: path.join(outDir, "llms.txt"),
          wellKnownLlmsTxt: path.join(outDir, ".well-known", "llms.txt"),
          ...(agentSkillsIndex ? { agentSkills: agentSkillsIndex } : {}),
          ...(mcpServerCard ? { mcpServerCard: mcpServerCard.outputPath } : {}),
          ...(mcpServerCard ? { mcpJson: mcpServerCard.rootPath } : {}),
          ...(mcpServerCard
            ? { mcpWellKnown: mcpServerCard.wellKnownPath }
            : {}),
          ...(nlwebArtifacts
            ? {
                nlwebSchemaFeed: nlwebArtifacts.files.schemaFeed,
                nlwebSchemaMap: nlwebArtifacts.files.schemaMap,
              }
            : {}),
          searchContent: search.contentOutputPath,
          searchIndex: search.outputPath,
        },
        filters: sourceMirror.filters,
        groups,
        ...(effectiveNav ? { nav: effectiveNav } : {}),
        mounts: effectiveMounts,
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
    // Print the root-pointer wiring snippet after a bundle run so authors know
    // the one setup step that makes agents actually read the docs. Text mode
    // only — JSON output stays a clean machine record on stdout.
    if (result.mode === "bundle" && args.format !== "json") {
      const packageName = await readBundlePackageName(outDir, product.name);
      io.stdout.write(`${renderBundlePointerGuidance(packageName)}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportFailure(message);
    return 1;
  } finally {
    await sourceMirror?.cleanup();
    await generateLock?.release();
  }
  return 0;
}
