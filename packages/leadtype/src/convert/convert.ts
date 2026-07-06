import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, rmdir } from "node:fs/promises";
import { cpus } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import type { Root } from "mdast";
import { mdxToMdast } from "satteri";
import { glob as fg } from "tinyglobby";
import type { PluggableList } from "unified";
import { writeFileAtomic } from "../internal/atomic-fs";
import {
  deriveDocContext,
  resolvePlaceholderStrings,
} from "../internal/docs-context";
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "../internal/frontmatter";
import {
  acquireGenerateLock,
  type GenerateLock,
  isGenerateLockHeld,
} from "../internal/generate-lock";
import { logger } from "../internal/logger";
import {
  createMdastTransforms,
  type LeadtypeMdastTransform,
  runMdastTransforms,
  stringifyMarkdown,
} from "../markdown";
import {
  createIncludeResolutionCache,
  type IncludeResolutionCache,
} from "../remark/plugins/include.remark";
import {
  type DocsFrontmatter,
  type DocsTransformerOptions,
  runTransformers,
  validateFrontmatter,
} from "../transformers";

const execFileAsync = promisify(execFile);

const DEFAULT_CONCURRENCY = Math.max(2, Math.min(cpus().length, 16));

/**
 * Run `fn` on every item in `items` with at most `limit` in-flight concurrent
 * calls. Uses a shared cursor so fast workers pull from the queue — keeps
 * throughput high when file conversion times vary (some hit git, some don't).
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      const item = items[index];
      if (item === undefined) {
        return;
      }
      results[index] = await fn(item, index);
    }
  });
  await Promise.all(workers);
  return results;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const HEADING_REGEX = /^#\s+(.+)$/m;
const YAML_QUOTE_REGEX = /["\\]/g;
const TABLE_DIVIDER_REGEX = /^:?-{2,}:?$/;
const MDX_EXTENSION_REGEX = /\.mdx$/;
const TITLE_CASE_REGEX = /\b\w/g;
const NAME_SEPARATOR_REGEX = /[-_]+/g;
const LIST_PREFIX_REGEX = /^\d+\.\s/;
const DEFAULT_SOURCE_DIR = "docs";
const GENERIC_DOC_NAMES = new Set(["home", "index", "readme"]);
const GIT_ENRICHMENT_COMMIT_LIMIT = 50;
const GIT_RECORD_SEPARATOR = "\x1e";
const GIT_FIELD_SEPARATOR = "\0";
const GIT_LOG_FORMAT = "%x1e%aI%x00%an";
const GIT_LOG_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const GIT_REPOSITORY_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_QUARANTINE_PATH",
  "GIT_WORK_TREE",
] as const;
const SATTERI_FEATURES = {
  frontmatter: false,
  gfm: true,
} as const;

function gitSubprocessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of GIT_REPOSITORY_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

const BOT_AUTHOR_NAMES = new Set([
  "claude",
  "claude code",
  "codex",
  "dependabot",
  "github-actions",
  "github actions",
  "netlify",
  "openai codex",
  "renovate",
  "vercel",
]);

function normalizeGitAuthor(author: string): string {
  return author.trim().toLowerCase();
}

function normalizeIgnoredAuthors(
  ignoredAuthors: readonly string[] | undefined
): ReadonlySet<string> {
  return new Set(
    (ignoredAuthors ?? []).map(normalizeGitAuthor).filter((name) => name)
  );
}

function isIgnoredGitAuthor(
  author: string,
  ignoredAuthors: ReadonlySet<string>
): boolean {
  const normalizedAuthor = normalizeGitAuthor(author);
  return (
    ignoredAuthors.has(normalizedAuthor) ||
    BOT_AUTHOR_NAMES.has(normalizedAuthor) ||
    normalizedAuthor.includes("[bot]") ||
    normalizedAuthor.endsWith(" bot") ||
    normalizedAuthor.endsWith("-bot") ||
    normalizedAuthor.endsWith("_bot")
  );
}

function toYamlScalar(value: string): string {
  return `"${value.replace(YAML_QUOTE_REGEX, "\\$&")}"`;
}

function titleFromFileName(sourcePath: string): string {
  const fileName = basename(sourcePath, ".mdx");
  const segment = GENERIC_DOC_NAMES.has(fileName.toLowerCase())
    ? basename(dirname(sourcePath))
    : fileName;
  const normalizedName = segment.replace(NAME_SEPARATOR_REGEX, " ").trim();
  return normalizedName.replace(TITLE_CASE_REGEX, (match) =>
    match.toUpperCase()
  );
}

/**
 * Build a title + description frontmatter from the markdown body when the
 * source file didn't include its own frontmatter block.
 */
function synthesizeFrontmatter(sourcePath: string, markdown: string): string {
  const title =
    markdown.match(HEADING_REGEX)?.[1]?.trim() ?? titleFromFileName(sourcePath);

  const lines = markdown.split("\n");
  const paragraphLines: string[] = [];
  let insideFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence || line.length === 0) {
      if (paragraphLines.length > 0) {
        break;
      }
      continue;
    }
    if (
      line.startsWith("#") ||
      line.startsWith(">") ||
      line.startsWith("|") ||
      line.startsWith("<") ||
      line.startsWith("- ") ||
      line.startsWith("* ") ||
      LIST_PREFIX_REGEX.test(line)
    ) {
      if (paragraphLines.length > 0) {
        break;
      }
      continue;
    }
    paragraphLines.push(line);
  }

  const description = paragraphLines.join(" ").trim();
  const frontmatterLines = [`title: ${toYamlScalar(title)}`];

  if (description.length > 0) {
    frontmatterLines.push(`description: ${toYamlScalar(description)}`);
  }

  return frontmatterLines.join("\n");
}

function compactTableCell(cell: string): string {
  const trimmed = cell.trim();
  if (TABLE_DIVIDER_REGEX.test(trimmed)) {
    const leftAligned = trimmed.startsWith(":");
    const rightAligned = trimmed.endsWith(":");
    return `${leftAligned ? ":" : ""}--${rightAligned ? ":" : ""}`;
  }
  return trimmed;
}

function compactMarkdownTables(markdown: string): string {
  const lines = markdown.split("\n");
  const compacted: string[] = [];
  let insideFence = false;

  for (const rawLine of lines) {
    if (rawLine.trim().startsWith("```")) {
      insideFence = !insideFence;
      compacted.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();
    const isTableLine =
      !insideFence &&
      trimmed.startsWith("|") &&
      trimmed.endsWith("|") &&
      trimmed.slice(1, -1).includes("|");

    if (!isTableLine) {
      compacted.push(rawLine);
      continue;
    }

    const indent = rawLine.match(/^\s*/)?.[0] ?? "";
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => compactTableCell(cell));
    compacted.push(`${indent}|${cells.join("|")}|`);
  }

  return compacted.join("\n");
}

function compactMermaidBlocks(markdown: string): string {
  // The previous implementation replaced `<br/>` with ` - ` inside mermaid
  // bodies for "readability", but `<br/>` is mermaid's own syntax for line
  // breaks inside node labels — substituting it broke any downstream
  // renderer. No transform is currently needed; the function is kept as
  // a named call site for future per-line normalization if it's ever needed.
  return markdown;
}

function serializeTransformedAst(ast: Root): string {
  return compactMermaidBlocks(compactMarkdownTables(stringifyMarkdown(ast)));
}

export type MdxConversionTiming = {
  filePath: string;
  parseMs: number;
  stringifyMs: number;
  totalMs: number;
  transformMs: number;
};

type ConversionTimingAccumulator = Pick<
  MdxConversionTiming,
  "parseMs" | "stringifyMs" | "transformMs"
>;

export type MdxToMarkdownOptions = {
  /** Source directory containing .mdx files */
  srcDir?: string;
  /** Output directory for .md files */
  outDir?: string;
  /** Native markdown/MDAST transforms (e.g. defaultMarkdownTransforms from leadtype/markdown). */
  markdownTransforms?: PluggableList;
  /**
   * If true, inject `lastModified` (ISO-8601) and `lastAuthor` into the
   * output frontmatter from git history. `lastModified` uses the latest file
   * commit; `lastAuthor` uses the latest non-bot author. Silently skipped for
   * files that are untracked or when git is unavailable.
   * Requires `fetch-depth: 0` when run in `actions/checkout` — shallow clones
   * return empty git log for files not touched in the single fetched commit.
   */
  enrichFrontmatterFromGit?: boolean;
  /**
   * Additional git author names to ignore when deriving generated markdown
   * `lastAuthor`. Matching is case-insensitive and additive with built-in bot
   * author detection.
   */
  ignoredGitAuthors?: string[];
  /**
   * Optional resolver for staged conversion inputs. When set, git enrichment
   * runs against the original source file instead of the staged mirror path.
   */
  gitSourcePath?: (filePath: string) => string | undefined;
  /**
   * Max number of files to convert in parallel. Defaults to
   * `min(cpuCount, 16)` with a floor of 2.
   */
  concurrency?: number;
  /** Throw after batch conversion if any file fails. */
  failOnError?: boolean;
  /**
   * After a fully successful batch, delete `.md` files under `outDir` whose
   * source `.mdx` no longer exists (deleted or renamed pages). Skipped — with
   * a warning — when any file fails to convert or when `srcDir` resolves to
   * zero pages, so a partial or misconfigured run never mass-deletes output.
   * While pruning, the run holds the same per-outDir lock as
   * `leadtype generate` (opt out with `LEADTYPE_NO_LOCK=1`). Only affects
   * `convertAllMdx`. Default `false`.
   */
  prune?: boolean;
  /**
   * Glob patterns (relative to `outDir`) for `.md` files `prune` must keep,
   * e.g. mirrors or aliases written into the same `outDir` by other tools
   * after conversion. `sitemap.md` is always kept.
   */
  pruneKeep?: string[];
  /** Build-time lifecycle hooks for frontmatter, AST, and markdown output. */
  transformers?: DocsTransformerOptions["transformers"];
  /** Optional schema used to validate resolved frontmatter before exposing it. */
  frontmatterSchema?: DocsTransformerOptions["frontmatterSchema"];
  /** Optional path-scoped schemas. The longest matching pathPrefix wins. */
  frontmatterSchemaByPath?: {
    filePaths?: string[];
    pathPrefix: string;
    schema: DocsTransformerOptions["frontmatterSchema"];
  }[];
  /** Extra context passed to transformer hooks. */
  transformContext?: DocsTransformerOptions["transformContext"];
  /** Per-file conversion timings used by benchmark scripts. */
  onTiming?: (timing: MdxConversionTiming) => void;
};

function resolveMarkdownTransforms(
  config: Pick<MdxToMarkdownOptions, "markdownTransforms">
): PluggableList {
  return config.markdownTransforms ?? [];
}

type GitEnrichment = {
  lastModified?: string;
  lastAuthor?: string;
};

type ConversionPrepareOptions<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = DocsTransformerOptions<TFrontmatter> & {
  gitSourcePath?: (filePath: string) => string | undefined;
  ignoredGitAuthors?: string[];
  gitEnrichment?: GitEnrichment;
  includeResolutionCache?: IncludeResolutionCache;
  onTiming?: (timing: MdxConversionTiming) => void;
};

type GitSourceGroup = {
  gitRoot: string;
  historyRoot: string;
};

function addTiming(
  timings: ConversionTimingAccumulator,
  key: keyof ConversionTimingAccumulator,
  startedAt: number
): void {
  timings[key] += performance.now() - startedAt;
}

function ensureMdastRoot(node: unknown): Root {
  if (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    node.type === "root" &&
    "children" in node &&
    Array.isArray(node.children)
  ) {
    return node as Root;
  }
  throw new Error("Satteri did not return an mdast root node.");
}

function parseMdxAst(
  content: string,
  timings: ConversionTimingAccumulator
): Root {
  const startedAt = performance.now();
  try {
    return ensureMdastRoot(mdxToMdast(content, { features: SATTERI_FEATURES }));
  } finally {
    addTiming(timings, "parseMs", startedAt);
  }
}

async function runMdxAstTransforms(
  transforms: readonly LeadtypeMdastTransform[],
  ast: Root,
  content: string,
  sourcePath: string,
  timings: ConversionTimingAccumulator,
  fileData?: Record<string, unknown>
): Promise<Root> {
  const startedAt = performance.now();
  try {
    return await runMdastTransforms(ast, transforms, {
      filePath: sourcePath,
      value: content,
      ...(fileData ? { data: fileData } : {}),
    });
  } finally {
    addTiming(timings, "transformMs", startedAt);
  }
}

function serializeWithTiming(
  ast: Root,
  timings: ConversionTimingAccumulator
): string {
  const startedAt = performance.now();
  try {
    return serializeTransformedAst(ast);
  } finally {
    addTiming(timings, "stringifyMs", startedAt);
  }
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function frontmatterSchemaForFile(
  filePath: string,
  srcDir: string,
  config: MdxToMarkdownOptions
): DocsTransformerOptions["frontmatterSchema"] {
  const scopedSchemas = config.frontmatterSchemaByPath ?? [];
  if (scopedSchemas.length === 0) {
    return config.frontmatterSchema;
  }
  const relativePath = normalizeRelativePath(relative(srcDir, filePath));
  const match = scopedSchemas
    .filter((entry) => {
      if (entry.filePaths) {
        return entry.filePaths.some(
          (entryPath) => normalizeRelativePath(entryPath) === relativePath
        );
      }
      const prefix = normalizeRelativePath(entry.pathPrefix).replace(
        /^\/+|\/+$/g,
        ""
      );
      return (
        prefix.length > 0 &&
        (relativePath === prefix || relativePath.startsWith(`${prefix}/`))
      );
    })
    .sort((left, right) => right.pathPrefix.length - left.pathPrefix.length)
    .at(0);
  return match?.schema ?? config.frontmatterSchema;
}

async function canonicalPath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return resolve(filePath);
  }
}

async function findGitRoot(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd,
        encoding: "utf8",
        env: gitSubprocessEnv(),
      }
    );
    const gitRoot = stdout.trim();
    return gitRoot.length > 0 ? await canonicalPath(gitRoot) : undefined;
  } catch {
    return;
  }
}

function commonAncestor(paths: readonly string[]): string {
  if (paths.length === 0) {
    return process.cwd();
  }

  const resolvedPaths = paths.map((filePath) => dirname(resolve(filePath)));
  const firstPath = resolvedPaths[0];
  if (!firstPath) {
    return process.cwd();
  }

  let commonParts = firstPath.split(sep);
  for (const candidate of resolvedPaths.slice(1)) {
    const candidateParts = candidate.split(sep);
    let index = 0;
    while (
      index < commonParts.length &&
      commonParts[index] === candidateParts[index]
    ) {
      index += 1;
    }
    commonParts = commonParts.slice(0, index);
  }

  return commonParts.join(sep) || sep;
}

function toGitPathspec(
  gitRoot: string,
  targetPath: string
): string | undefined {
  const relativePath = relative(gitRoot, resolve(targetPath));
  if (relativePath === "") {
    return ".";
  }
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    return;
  }
  return normalizeRelativePath(relativePath);
}

async function groupGitSourcePaths(
  filePaths: readonly string[]
): Promise<GitSourceGroup[]> {
  const groups = new Map<string, string[]>();
  const gitRootByDirectory = new Map<string, string | undefined>();

  for (const filePath of filePaths) {
    const canonicalFilePath = await canonicalPath(filePath);
    const sourceDir = dirname(canonicalFilePath);
    let gitRoot = gitRootByDirectory.get(sourceDir);
    if (!gitRootByDirectory.has(sourceDir)) {
      gitRoot = await findGitRoot(sourceDir);
      gitRootByDirectory.set(sourceDir, gitRoot);
    }
    if (!gitRoot) {
      continue;
    }

    const groupFilePaths = groups.get(gitRoot) ?? [];
    groupFilePaths.push(canonicalFilePath);
    groups.set(gitRoot, groupFilePaths);
  }

  return Array.from(groups, ([gitRoot, groupFilePaths]) => ({
    gitRoot,
    historyRoot: commonAncestor(groupFilePaths),
  }));
}

function parseGitHistory(
  stdout: string,
  gitRoot: string,
  ignoredAuthors: readonly string[] | undefined
): Map<string, GitEnrichment> {
  const ignoredAuthorSet = normalizeIgnoredAuthors(ignoredAuthors);
  const enrichments = new Map<string, GitEnrichment>();
  const commitCountsByPath = new Map<string, number>();

  for (const record of stdout.split(GIT_RECORD_SEPARATOR)) {
    if (record.length === 0) {
      continue;
    }

    const [iso, author, ...rawPaths] = record.split(GIT_FIELD_SEPARATOR);
    if (!iso) {
      continue;
    }

    for (const rawPath of rawPaths) {
      const gitPath = rawPath.replace(/^\r?\n/, "");
      if (gitPath.length === 0) {
        continue;
      }

      const absolutePath = resolve(gitRoot, gitPath);
      const commitCount = commitCountsByPath.get(absolutePath) ?? 0;
      if (commitCount >= GIT_ENRICHMENT_COMMIT_LIMIT) {
        continue;
      }
      commitCountsByPath.set(absolutePath, commitCount + 1);

      const enrichment = enrichments.get(absolutePath) ?? {};
      if (!enrichment.lastModified) {
        enrichment.lastModified = iso;
      }
      if (
        !enrichment.lastAuthor &&
        author &&
        !isIgnoredGitAuthor(author, ignoredAuthorSet)
      ) {
        enrichment.lastAuthor = author;
      }
      enrichments.set(absolutePath, enrichment);
    }
  }

  return enrichments;
}

async function readGitEnrichmentMap(
  filePaths: readonly string[],
  ignoredAuthors: readonly string[] | undefined
): Promise<Map<string, GitEnrichment>> {
  if (filePaths.length === 0) {
    return new Map();
  }

  const requestedPaths = new Map<string, string>();
  for (const filePath of filePaths) {
    const resolvedPath = resolve(filePath);
    requestedPaths.set(resolvedPath, resolvedPath);
    requestedPaths.set(await canonicalPath(filePath), resolvedPath);
  }

  const enrichments = new Map<string, GitEnrichment>();
  const groups = await groupGitSourcePaths(filePaths);
  for (const { gitRoot, historyRoot } of groups) {
    const historyPathspec = toGitPathspec(gitRoot, historyRoot);
    if (!historyPathspec) {
      continue;
    }

    try {
      const { stdout } = await execFileAsync(
        "git",
        [
          "log",
          `--format=${GIT_LOG_FORMAT}`,
          "--name-only",
          "-z",
          "--",
          historyPathspec,
        ],
        {
          cwd: gitRoot,
          encoding: "utf8",
          env: gitSubprocessEnv(),
          maxBuffer: GIT_LOG_MAX_BUFFER_BYTES,
        }
      );
      const parsed = parseGitHistory(stdout, gitRoot, ignoredAuthors);
      for (const [gitPath, enrichment] of parsed) {
        const requestedPath = requestedPaths.get(gitPath);
        if (requestedPath) {
          enrichments.set(requestedPath, enrichment);
        }
      }
    } catch {
      // Keep enrichment best-effort per source repository.
    }
  }
  return enrichments;
}

/**
 * Read the latest commit date and latest non-bot author-name for a file.
 * Best-effort — returns empty object on any failure (untracked file, no .git,
 * missing binary) so callers never need to handle errors.
 */
async function enrichFromGit(
  filePath: string,
  ignoredAuthors: readonly string[] | undefined
): Promise<GitEnrichment> {
  try {
    const cwd = dirname(resolve(filePath));
    // Use NUL as separator so author names containing '|' (e.g. "Jane | Co")
    // round-trip correctly.
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        `--max-count=${GIT_ENRICHMENT_COMMIT_LIMIT}`,
        "--format=%aI%x00%an",
        "--",
        relative(cwd, resolve(filePath)),
      ],
      { cwd, encoding: "utf8", env: gitSubprocessEnv() }
    );
    const lines = stdout.trimEnd().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      return {};
    }
    const ignoredAuthorSet = normalizeIgnoredAuthors(ignoredAuthors);
    const enrichment: GitEnrichment = {};
    for (const [index, line] of lines.entries()) {
      const [iso, author] = line.split("\0");
      if (index === 0 && iso) {
        enrichment.lastModified = iso;
      }
      if (author && !isIgnoredGitAuthor(author, ignoredAuthorSet)) {
        enrichment.lastAuthor = author;
        break;
      }
    }
    return enrichment;
  } catch {
    return {};
  }
}

function applyEnrichment(
  frontmatterBlock: string,
  enrichment: GitEnrichment
): string {
  if (!(enrichment.lastModified || enrichment.lastAuthor)) {
    return frontmatterBlock;
  }
  const parsed = parseFrontmatter(`---\n${frontmatterBlock}\n---\n`);
  const merged: Record<string, unknown> = {
    ...parsed.data,
    ...(enrichment.lastModified && { lastModified: enrichment.lastModified }),
    ...(enrichment.lastAuthor && { lastAuthor: enrichment.lastAuthor }),
  };
  return stringifyFrontmatter(merged);
}

function resolveFrontmatterPlaceholders(
  frontmatterBlock: string,
  sourcePath: string
): string {
  if (frontmatterBlock.trim().length === 0) {
    return frontmatterBlock;
  }

  const parsed = parseFrontmatter(`---\n${frontmatterBlock}\n---\n`);
  const resolvedData = resolvePlaceholderStrings(
    parsed.data,
    deriveDocContext(sourcePath)
  );
  return stringifyFrontmatter(resolvedData);
}

export type ConvertResult = {
  markdown: string;
  frontmatter: string;
};

export type ConvertMdxFileResult<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = {
  /** mdast Root after every supplied plugin has run. Use this to render MDX live. */
  ast: Root;
  /** Resolved frontmatter block (no `---` fences) as it would appear on disk. */
  frontmatter: string;
  /** Parsed frontmatter as a plain object. */
  data: TFrontmatter;
  /** Serialized markdown body (post compact-tables/compact-mermaid). */
  markdown: string;
};

type PreparedMdxConversion<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = {
  content: string;
  frontmatter: string;
  data: TFrontmatter;
  ast: Root;
  shouldRewriteFrontmatter: boolean;
  timings: ConversionTimingAccumulator;
};

export type ResolvedMdxFrontmatterResult<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = Pick<
  PreparedMdxConversion<TFrontmatter>,
  "content" | "data" | "frontmatter"
>;

async function prepareMdxConversion<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  sourcePath: string,
  markdownTransforms: PluggableList,
  enrichFromGitFlag: boolean,
  options: ConversionPrepareOptions<TFrontmatter>
): Promise<PreparedMdxConversion<TFrontmatter>> {
  const rawInput = await readFile(sourcePath, "utf8");
  const rawPage = await runTransformers(
    options.transformers,
    "beforeParse",
    { filePath: sourcePath, raw: rawInput },
    {
      stage: "convert",
      filePath: sourcePath,
      ...options.transformContext,
    },
    (transformer, value, context) => transformer.beforeParse?.(value, context)
  );
  const raw = rawPage.raw;
  const shouldRewriteFrontmatter = Boolean(
    options.frontmatterSchema || (options.transformers?.length ?? 0) > 0
  );
  const timings: ConversionTimingAccumulator = {
    parseMs: 0,
    stringifyMs: 0,
    transformMs: 0,
  };
  const nativeTransforms = createMdastTransforms(markdownTransforms);
  const frontmatterMatch = raw.match(FRONTMATTER_REGEX);
  let frontmatter = "";
  let content = raw;

  if (frontmatterMatch) {
    frontmatter = frontmatterMatch[1] ?? "";
    content = frontmatterMatch[2] ?? "";
  }

  const fileData = options.includeResolutionCache
    ? { _leadtypeIncludeCache: options.includeResolutionCache }
    : undefined;
  const parsed = parseMdxAst(content, timings);
  let ast = await runMdxAstTransforms(
    nativeTransforms,
    parsed,
    content,
    sourcePath,
    timings,
    fileData
  );

  let resolvedFrontmatter =
    frontmatter.trim().length > 0
      ? frontmatter
      : synthesizeFrontmatter(sourcePath, serializeTransformedAst(ast));

  if (enrichFromGitFlag) {
    const gitSourcePath = options.gitSourcePath?.(sourcePath) ?? sourcePath;
    const enrichment =
      options.gitEnrichment ??
      (await enrichFromGit(gitSourcePath, options.ignoredGitAuthors));
    resolvedFrontmatter = applyEnrichment(resolvedFrontmatter, enrichment);
  }

  resolvedFrontmatter = resolveFrontmatterPlaceholders(
    resolvedFrontmatter,
    sourcePath
  );

  const initialParsedData =
    resolvedFrontmatter.trim().length > 0
      ? parseFrontmatter(`---\n${resolvedFrontmatter}\n---\n`).data
      : {};
  let parsedData = initialParsedData as TFrontmatter;

  const frontmatterPage = await runTransformers(
    options.transformers,
    "afterFrontmatter",
    {
      filePath: sourcePath,
      content,
      frontmatter: resolvedFrontmatter,
      data: parsedData,
    },
    {
      stage: "convert",
      filePath: sourcePath,
      ...options.transformContext,
    },
    (transformer, value, context) =>
      transformer.afterFrontmatter?.(value, context)
  );
  if (frontmatterPage.content !== content) {
    content = frontmatterPage.content;
    const reparsed = parseMdxAst(content, timings);
    ast = await runMdxAstTransforms(
      nativeTransforms,
      reparsed,
      content,
      sourcePath,
      timings,
      fileData
    );
  }
  parsedData = validateFrontmatter(
    options.frontmatterSchema,
    frontmatterPage.data,
    sourcePath
  );
  if (shouldRewriteFrontmatter) {
    resolvedFrontmatter = stringifyFrontmatter(parsedData);
  }

  return {
    content,
    frontmatter: resolvedFrontmatter,
    data: parsedData,
    ast,
    shouldRewriteFrontmatter,
    timings,
  };
}

export async function resolveMdxFrontmatter<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  sourcePath: string,
  markdownTransforms: PluggableList = [],
  enrichFromGitFlag = false,
  options: ConversionPrepareOptions<TFrontmatter> = {}
): Promise<ResolvedMdxFrontmatterResult<TFrontmatter>> {
  const prepared = await prepareMdxConversion(
    sourcePath,
    markdownTransforms,
    enrichFromGitFlag,
    options
  );
  return {
    content: prepared.content,
    frontmatter: prepared.frontmatter,
    data: prepared.data,
  };
}

/**
 * Convert a single MDX file in memory and return the post-transform mdast
 * AST alongside the parsed frontmatter and serialized markdown body.
 *
 * Useful when the caller wants to render MDX as live components (so they
 * need the AST) but also wants the markdown form available (for search
 * indexing, RSS, etc.) in a single pass.
 *
 * Frontmatter handling matches `convertMdxToMarkdown`: synthesized when
 * absent, enriched from git when requested, placeholders resolved.
 */
export async function convertMdxFile<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  sourcePath: string,
  markdownTransforms: PluggableList = [],
  enrichFromGitFlag = false,
  options: ConversionPrepareOptions<TFrontmatter> = {}
): Promise<ConvertMdxFileResult<TFrontmatter>> {
  const totalStartedAt = performance.now();
  const includeResolutionCache =
    options.includeResolutionCache ?? createIncludeResolutionCache();
  const prepared = await prepareMdxConversion(
    sourcePath,
    markdownTransforms,
    enrichFromGitFlag,
    { ...options, includeResolutionCache }
  );
  const { content, shouldRewriteFrontmatter } = prepared;
  let {
    ast: transformed,
    data: parsedData,
    frontmatter: resolvedFrontmatter,
  } = prepared;

  const astPage = await runTransformers(
    options.transformers,
    "afterMdxAst",
    {
      filePath: sourcePath,
      content,
      frontmatter: resolvedFrontmatter,
      data: parsedData,
      ast: transformed,
    },
    {
      stage: "convert",
      filePath: sourcePath,
      ...options.transformContext,
    },
    (transformer, value, context) => transformer.afterMdxAst?.(value, context)
  );
  transformed = astPage.ast;
  parsedData = validateFrontmatter(
    options.frontmatterSchema,
    astPage.data,
    sourcePath
  );
  if (shouldRewriteFrontmatter) {
    resolvedFrontmatter = stringifyFrontmatter(parsedData);
  }

  const markdown = serializeWithTiming(transformed, prepared.timings);

  const markdownPage = await runTransformers(
    options.transformers,
    "afterFlattenMarkdown",
    {
      filePath: sourcePath,
      content,
      frontmatter: resolvedFrontmatter,
      data: parsedData,
      ast: transformed,
      markdown,
    },
    {
      stage: "convert",
      filePath: sourcePath,
      ...options.transformContext,
    },
    (transformer, value, context) =>
      transformer.afterFlattenMarkdown?.(value, context)
  );
  parsedData = validateFrontmatter(
    options.frontmatterSchema,
    markdownPage.data,
    sourcePath
  );
  if (shouldRewriteFrontmatter) {
    resolvedFrontmatter = stringifyFrontmatter(parsedData);
  }

  options.onTiming?.({
    filePath: sourcePath,
    parseMs: prepared.timings.parseMs,
    stringifyMs: prepared.timings.stringifyMs,
    totalMs: performance.now() - totalStartedAt,
    transformMs: prepared.timings.transformMs,
  });

  return {
    ast: markdownPage.ast,
    frontmatter: resolvedFrontmatter,
    data: parsedData,
    markdown: markdownPage.markdown,
  };
}

/**
 * Convert a single MDX file to markdown in memory. Returns the rendered
 * markdown plus the (possibly synthesized) frontmatter block.
 */
export async function convertMdxToMarkdown(
  sourcePath: string,
  markdownTransforms: PluggableList = [],
  enrichFromGitFlag = false,
  options: ConversionPrepareOptions = {}
): Promise<ConvertResult> {
  const result = await convertMdxFile(
    sourcePath,
    markdownTransforms,
    enrichFromGitFlag,
    options
  );

  const withFrontmatter = result.frontmatter
    ? `---\n${result.frontmatter}\n---\n${result.markdown}`
    : result.markdown;

  return {
    markdown: withFrontmatter,
    frontmatter: result.frontmatter,
  };
}

function deriveOutputPath(
  inputFilePath: string,
  srcDir: string,
  outDir: string
): string {
  const normalizedSrcDir = resolve(srcDir) + sep;
  const normalizedInput = resolve(inputFilePath);

  // Windows filesystems are case-insensitive; POSIX is case-sensitive, so
  // only lowercase on win32 to avoid matching paths that differ only in case.
  const isWindows = process.platform === "win32";
  const isUnder = isWindows
    ? normalizedInput.toLowerCase().startsWith(normalizedSrcDir.toLowerCase())
    : normalizedInput.startsWith(normalizedSrcDir);

  if (isUnder) {
    const relativePath = relative(srcDir, normalizedInput);
    return join(outDir, relativePath.replace(MDX_EXTENSION_REGEX, ".md"));
  }

  return join(
    outDir,
    basename(normalizedInput).replace(MDX_EXTENSION_REGEX, ".md")
  );
}

async function processMdxFile(
  mdxFilePath: string,
  srcDir: string,
  outDir: string,
  markdownTransforms: PluggableList,
  enrichFromGitFlag: boolean,
  transformOptions: ConversionPrepareOptions,
  writeToStdout = false
): Promise<boolean> {
  const resolvedPath = resolve(mdxFilePath);

  if (!resolvedPath.endsWith(".mdx")) {
    logger.error({
      human: { message: `not an MDX file: ${resolvedPath}` },
      json: { event: "convert.skip_non_mdx", fields: { path: resolvedPath } },
    });
    return false;
  }

  try {
    const startedAt = Date.now();
    const { markdown } = await convertMdxToMarkdown(
      resolvedPath,
      markdownTransforms,
      enrichFromGitFlag,
      transformOptions
    );
    const outputPath = deriveOutputPath(resolvedPath, srcDir, outDir);

    if (writeToStdout) {
      process.stdout.write(markdown);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFileAtomic(outputPath, markdown);

    if (!writeToStdout) {
      const ms = Date.now() - startedAt;
      logger.debug({
        human: { message: `convert ${resolvedPath} → ${outputPath} (${ms}ms)` },
        json: {
          event: "convert.file",
          fields: { src: resolvedPath, out: outputPath, ms },
        },
      });
    }
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error({
      human: {
        message: `failed to process ${mdxFilePath}: ${reason}`,
        hint: stack ?? "run with LEADTYPE_VERBOSE=1 for more verbose logs",
      },
      json: {
        event: "convert.fail",
        fields: stack
          ? { file: mdxFilePath, reason, stack }
          : { file: mdxFilePath, reason },
      },
    });
    return false;
  }
}

/**
 * Convert a single MDX file and write the output. Also writes to stdout so
 * build scripts can pipe/stream output when invoked on one file at a time.
 */
export async function writeMdxFileAsMarkdown(
  mdxFilePath: string,
  config: MdxToMarkdownOptions = {}
): Promise<boolean> {
  const srcDir = config.srcDir
    ? resolve(config.srcDir)
    : resolve(process.cwd(), DEFAULT_SOURCE_DIR);
  const outDir = config.outDir
    ? resolve(config.outDir)
    : resolve(process.cwd(), "public");
  const markdownTransforms = resolveMarkdownTransforms(config);
  return await processMdxFile(
    mdxFilePath,
    srcDir,
    outDir,
    markdownTransforms,
    config.enrichFrontmatterFromGit ?? false,
    {
      frontmatterSchema: config.frontmatterSchema,
      gitSourcePath: config.gitSourcePath,
      ignoredGitAuthors: config.ignoredGitAuthors,
      transformers: config.transformers,
      transformContext: config.transformContext,
      includeResolutionCache: createIncludeResolutionCache(),
      onTiming: config.onTiming,
    },
    true
  );
}

/** Generated by the pipeline into the same outDir; never a conversion output. */
const PRUNE_ALWAYS_KEEP = ["sitemap.md"];

/**
 * Delete `.md` files under `outDir` that this batch did not produce, then
 * best-effort remove directories the deletions emptied. Non-`.md` files are
 * never touched, and `keepPatterns` (plus `sitemap.md`) are exempt.
 */
async function pruneOrphanedOutputs(
  outDir: string,
  expectedOutputs: Set<string>,
  keepPatterns: string[]
): Promise<string[]> {
  const existing = await fg("**/*.md", {
    cwd: outDir,
    absolute: true,
    onlyFiles: true,
  });
  const keep = new Set(
    await fg([...PRUNE_ALWAYS_KEEP, ...keepPatterns], {
      cwd: outDir,
      absolute: true,
      onlyFiles: true,
    })
  );
  const orphans = existing.filter(
    (filePath) =>
      !(expectedOutputs.has(resolve(filePath)) || keep.has(filePath))
  );

  await Promise.all(orphans.map((filePath) => rm(filePath, { force: true })));

  // Deleting the last page of a section leaves an empty directory behind;
  // sweep upward until a non-empty parent (or outDir) stops the walk.
  const resolvedOutDir = resolve(outDir);
  const parents = new Set(orphans.map((filePath) => dirname(filePath)));
  for (let dir of parents) {
    while (dir !== resolvedOutDir && dir.startsWith(resolvedOutDir + sep)) {
      try {
        await rmdir(dir);
      } catch {
        break;
      }
      dir = dirname(dir);
    }
  }

  return orphans;
}

/**
 * Convert every .mdx file under srcDir to .md under outDir (preserving the
 * relative directory structure).
 */
export async function convertAllMdx(
  config: MdxToMarkdownOptions = {}
): Promise<void> {
  const srcDir = config.srcDir
    ? resolve(config.srcDir)
    : resolve(process.cwd(), DEFAULT_SOURCE_DIR);
  const outDir = config.outDir
    ? resolve(config.outDir)
    : resolve(process.cwd(), "public");

  if (!existsSync(srcDir)) {
    logger.debug({
      human: { message: `source directory does not exist: ${srcDir}` },
      json: { event: "convert.batch.no_src", fields: { srcDir } },
    });
    return;
  }

  const mdxFiles = await fg("**/*.mdx", {
    cwd: srcDir,
    absolute: true,
    onlyFiles: true,
  });

  if (mdxFiles.length === 0) {
    if (config.prune) {
      logger.warn({
        human: {
          message: `prune skipped: no .mdx sources under ${srcDir} — refusing to treat every output in ${outDir} as orphaned. Check srcDir if this is unexpected.`,
        },
        json: {
          event: "convert.prune.skip_no_sources",
          fields: { srcDir, outDir },
        },
      });
    }
    return;
  }

  // Pruning must not race another writer sharing this outDir (another prune
  // deleting outputs this run just wrote, or a `leadtype generate` run whose
  // artifacts would look orphaned mid-write), so it serializes on the same
  // per-outDir lock generate uses — unless this process already holds it
  // (generate calling convertAllMdx), where a second acquire would deadlock.
  const needsLock =
    Boolean(config.prune) &&
    process.env.LEADTYPE_NO_LOCK !== "1" &&
    !isGenerateLockHeld(outDir);
  const generateLock: GenerateLock | undefined = needsLock
    ? await acquireGenerateLock(outDir)
    : undefined;

  try {
    const failed = await convertMdxBatch(config, srcDir, outDir, mdxFiles);

    if (config.prune) {
      await pruneAfterBatch(config, srcDir, outDir, mdxFiles, failed);
    }

    if (failed > 0 && config.failOnError) {
      throw new Error(`Failed to convert ${failed} docs file(s).`);
    }
  } finally {
    await generateLock?.release();
  }
}

/** Prune orphaned outputs after a batch, or explain why pruning was skipped. */
async function pruneAfterBatch(
  config: MdxToMarkdownOptions,
  srcDir: string,
  outDir: string,
  mdxFiles: string[],
  failed: number
): Promise<void> {
  if (failed > 0) {
    logger.warn({
      human: {
        message: `prune skipped: ${failed} file(s) failed to convert, so the expected output set is incomplete.`,
      },
      json: {
        event: "convert.prune.skip_failed",
        fields: { outDir, failed },
      },
    });
    return;
  }

  const expectedOutputs = new Set(
    mdxFiles.map((mdxFilePath) =>
      resolve(deriveOutputPath(mdxFilePath, srcDir, outDir))
    )
  );
  const pruned = await pruneOrphanedOutputs(
    outDir,
    expectedOutputs,
    config.pruneKeep ?? []
  );
  if (pruned.length > 0) {
    logger.info({
      human: {
        message: `Pruned ${pruned.length} orphaned .md file(s) from ${outDir}`,
      },
      json: {
        event: "convert.prune",
        fields: { outDir, count: pruned.length, files: pruned },
      },
    });
  }
}

/** Run the conversion batch and return the number of failed files. */
async function convertMdxBatch(
  config: MdxToMarkdownOptions,
  srcDir: string,
  outDir: string,
  mdxFiles: string[]
): Promise<number> {
  const markdownTransforms = resolveMarkdownTransforms(config);
  const enrichFromGitFlag = config.enrichFrontmatterFromGit ?? false;
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const includeResolutionCache = createIncludeResolutionCache();
  const gitSourcePaths = mdxFiles.map(
    (mdxFilePath) => config.gitSourcePath?.(mdxFilePath) ?? mdxFilePath
  );
  const gitEnrichments = enrichFromGitFlag
    ? await readGitEnrichmentMap(gitSourcePaths, config.ignoredGitAuthors)
    : new Map<string, GitEnrichment>();

  // Pre-create every output directory in parallel so the per-file workers
  // don't repeatedly mkdir the same parent.
  const outputDirs = new Set<string>();
  for (const mdxFilePath of mdxFiles) {
    outputDirs.add(dirname(deriveOutputPath(mdxFilePath, srcDir, outDir)));
  }
  await Promise.all(
    Array.from(outputDirs, (dir) => mkdir(dir, { recursive: true }))
  );

  const startedAt = Date.now();
  const results = await mapLimit(mdxFiles, concurrency, async (mdxFilePath) => {
    try {
      const fileStartedAt = Date.now();
      const gitSourcePath = config.gitSourcePath?.(mdxFilePath) ?? mdxFilePath;
      const { markdown } = await convertMdxToMarkdown(
        mdxFilePath,
        markdownTransforms,
        enrichFromGitFlag,
        {
          frontmatterSchema: frontmatterSchemaForFile(
            mdxFilePath,
            srcDir,
            config
          ),
          gitSourcePath: config.gitSourcePath,
          ignoredGitAuthors: config.ignoredGitAuthors,
          gitEnrichment: gitEnrichments.get(resolve(gitSourcePath)) ?? {},
          includeResolutionCache,
          transformers: config.transformers,
          onTiming: config.onTiming,
          transformContext: {
            ...config.transformContext,
            filePath: mdxFilePath,
          },
        }
      );
      const outputPath = deriveOutputPath(mdxFilePath, srcDir, outDir);
      await writeFileAtomic(outputPath, markdown);
      logger.debug({
        human: {
          message: `convert ${mdxFilePath} → ${outputPath} (${Date.now() - fileStartedAt}ms)`,
        },
        json: {
          event: "convert.file",
          fields: {
            src: mdxFilePath,
            out: outputPath,
            ms: Date.now() - fileStartedAt,
          },
        },
      });
      return true;
    } catch (fileError) {
      const reason =
        fileError instanceof Error ? fileError.message : String(fileError);
      logger.error({
        human: { message: `failed to process ${mdxFilePath}: ${reason}` },
        json: {
          event: "convert.fail",
          fields: { file: mdxFilePath, reason },
        },
      });
      return false;
    }
  });

  const ok = results.filter(Boolean).length;
  const failed = results.length - ok;
  const ms = Date.now() - startedAt;
  logger.info({
    human: {
      message: `Converted ${ok} docs in ${ms} ms${failed > 0 ? ` (${failed} failed)` : ""}`,
    },
    json: {
      event: "convert.batch",
      fields: {
        srcDir,
        outDir,
        files: results.length,
        ok,
        failed,
        ms,
      },
    },
  });

  return failed;
}
