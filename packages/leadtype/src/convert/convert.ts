import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Root } from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import { glob as fg } from "tinyglobby";
import type { Pluggable, PluggableList } from "unified";
import {
  deriveDocContext,
  resolvePlaceholderStrings,
} from "../internal/docs-context";
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "../internal/frontmatter";
import { logger } from "../internal/logger";
import { sortRemarkPluginsByPhase } from "../internal/remark-phase";
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

function isBotAuthor(author: string): boolean {
  const normalizedAuthor = author.trim().toLowerCase();
  return (
    BOT_AUTHOR_NAMES.has(normalizedAuthor) ||
    normalizedAuthor.includes("[bot]") ||
    normalizedAuthor.endsWith(" bot") ||
    normalizedAuthor.endsWith("-bot") ||
    normalizedAuthor.endsWith("_bot")
  );
}

type RemarkProcessor = ReturnType<typeof remark>;

let cachedProcessor: RemarkProcessor | null = null;
let cachedPluginIds: PluggableList = [];

/**
 * Create (and cache) a remark processor with the given plugins. Plugins are
 * matched by identity — if the same plugin array is passed again, the existing
 * processor is reused. Plugins must be stateless/module-safe for reuse.
 */
function createRemarkProcessor(
  additionalPlugins: PluggableList = []
): RemarkProcessor {
  const sameLength = cachedPluginIds.length === additionalPlugins.length;
  const sameIdentity =
    sameLength &&
    additionalPlugins.every((plugin, i) => plugin === cachedPluginIds[i]);

  if (cachedProcessor && sameIdentity) {
    return cachedProcessor;
  }

  let processor: RemarkProcessor = remark()
    .use(remarkMdx)
    .use(remarkGfm)
    .data("settings", {
      tableCellPadding: false,
      tablePipeAlign: false,
    } as Record<string, unknown>);

  // Schedule plugins by phase (resolve → custom → flatten → post) so a custom
  // flattener appended to `defaultRemarkPlugins` still runs in the right slot.
  // Cache identity stays keyed on the original array (stable across calls).
  for (const plugin of sortRemarkPluginsByPhase(additionalPlugins)) {
    if (Array.isArray(plugin)) {
      const [factory, ...args] = plugin as [Pluggable, ...unknown[]];
      // biome-ignore lint/suspicious/noExplicitAny: unified's .use() overloads are too narrow for dynamic plugin arrays
      processor = (processor as any).use(factory, ...args);
      continue;
    }
    // biome-ignore lint/suspicious/noExplicitAny: unified's .use() overloads are too narrow for dynamic plugin arrays
    processor = (processor as any).use(plugin);
  }

  cachedProcessor = processor;
  cachedPluginIds = additionalPlugins.slice(0);
  return processor;
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

function serializeTransformedAst(
  processor: RemarkProcessor,
  ast: Root
): string {
  return compactMermaidBlocks(
    compactMarkdownTables(String(processor.stringify(ast)))
  );
}

export type MdxToMarkdownOptions = {
  /** Source directory containing .mdx files */
  srcDir?: string;
  /** Output directory for .md files */
  outDir?: string;
  /** Additional remark plugins (e.g. defaultRemarkPlugins from leadtype/remark) */
  remarkPlugins?: PluggableList;
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
};

type GitEnrichment = {
  lastModified?: string;
  lastAuthor?: string;
};

type ConversionPrepareOptions<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = DocsTransformerOptions<TFrontmatter> & {
  gitSourcePath?: (filePath: string) => string | undefined;
};

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

/**
 * Read the latest commit date and latest non-bot author-name for a file.
 * Best-effort — returns empty object on any failure (untracked file, no .git,
 * missing binary) so callers never need to handle errors.
 */
async function enrichFromGit(filePath: string): Promise<GitEnrichment> {
  try {
    // Use NUL as separator so author names containing '|' (e.g. "Jane | Co")
    // round-trip correctly.
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        `--max-count=${GIT_ENRICHMENT_COMMIT_LIMIT}`,
        "--format=%aI%x00%an",
        "--",
        filePath,
      ],
      { cwd: dirname(filePath), env: gitSubprocessEnv() }
    );
    const lines = stdout.trimEnd().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      return {};
    }
    const enrichment: GitEnrichment = {};
    for (const [index, line] of lines.entries()) {
      const [iso, author] = line.split("\0");
      if (index === 0 && iso) {
        enrichment.lastModified = iso;
      }
      if (author && !isBotAuthor(author)) {
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
  processor: RemarkProcessor;
  shouldRewriteFrontmatter: boolean;
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
  remarkPlugins: PluggableList,
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
  const processor = createRemarkProcessor(remarkPlugins);
  const frontmatterMatch = raw.match(FRONTMATTER_REGEX);
  let frontmatter = "";
  let content = raw;

  if (frontmatterMatch) {
    frontmatter = frontmatterMatch[1] ?? "";
    content = frontmatterMatch[2] ?? "";
  }

  const parsed = processor.parse({ value: content, path: sourcePath }) as Root;
  let ast = (await processor.run(parsed, {
    value: content,
    path: sourcePath,
  })) as Root;

  let resolvedFrontmatter =
    frontmatter.trim().length > 0
      ? frontmatter
      : synthesizeFrontmatter(
          sourcePath,
          serializeTransformedAst(processor, ast)
        );

  if (enrichFromGitFlag) {
    const gitSourcePath = options.gitSourcePath?.(sourcePath) ?? sourcePath;
    const enrichment = await enrichFromGit(gitSourcePath);
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
    const reparsed = processor.parse({
      value: content,
      path: sourcePath,
    }) as Root;
    ast = (await processor.run(reparsed, {
      value: content,
      path: sourcePath,
    })) as Root;
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
    processor,
    shouldRewriteFrontmatter,
  };
}

export async function resolveMdxFrontmatter<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  sourcePath: string,
  remarkPlugins: PluggableList = [],
  enrichFromGitFlag = false,
  options: ConversionPrepareOptions<TFrontmatter> = {}
): Promise<ResolvedMdxFrontmatterResult<TFrontmatter>> {
  const prepared = await prepareMdxConversion(
    sourcePath,
    remarkPlugins,
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
  remarkPlugins: PluggableList = [],
  enrichFromGitFlag = false,
  options: ConversionPrepareOptions<TFrontmatter> = {}
): Promise<ConvertMdxFileResult<TFrontmatter>> {
  const prepared = await prepareMdxConversion(
    sourcePath,
    remarkPlugins,
    enrichFromGitFlag,
    options
  );
  const { content, processor, shouldRewriteFrontmatter } = prepared;
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

  const markdown = serializeTransformedAst(processor, transformed);

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
  remarkPlugins: PluggableList = [],
  enrichFromGitFlag = false,
  options: ConversionPrepareOptions = {}
): Promise<ConvertResult> {
  const result = await convertMdxFile(
    sourcePath,
    remarkPlugins,
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
  remarkPlugins: PluggableList,
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
      remarkPlugins,
      enrichFromGitFlag,
      transformOptions
    );
    const outputPath = deriveOutputPath(resolvedPath, srcDir, outDir);

    if (writeToStdout) {
      process.stdout.write(markdown);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, markdown);

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
  const remarkPlugins = config.remarkPlugins ?? [];
  return await processMdxFile(
    mdxFilePath,
    srcDir,
    outDir,
    remarkPlugins,
    config.enrichFrontmatterFromGit ?? false,
    {
      frontmatterSchema: config.frontmatterSchema,
      gitSourcePath: config.gitSourcePath,
      transformers: config.transformers,
      transformContext: config.transformContext,
    },
    true
  );
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
    return;
  }

  const remarkPlugins = config.remarkPlugins ?? [];
  const enrichFromGitFlag = config.enrichFrontmatterFromGit ?? false;
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;

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
      const { markdown } = await convertMdxToMarkdown(
        mdxFilePath,
        remarkPlugins,
        enrichFromGitFlag,
        {
          frontmatterSchema: frontmatterSchemaForFile(
            mdxFilePath,
            srcDir,
            config
          ),
          gitSourcePath: config.gitSourcePath,
          transformers: config.transformers,
          transformContext: {
            ...config.transformContext,
            filePath: mdxFilePath,
          },
        }
      );
      const outputPath = deriveOutputPath(mdxFilePath, srcDir, outDir);
      await writeFile(outputPath, markdown);
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

  if (failed > 0 && config.failOnError) {
    throw new Error(`Failed to convert ${failed} docs file(s).`);
  }
}
