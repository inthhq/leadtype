import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import { convertAllMdx } from "../convert";
import { parseFrontmatter } from "../internal/frontmatter";
import {
  logger,
  setLogFormat,
  setLogStreams,
  setVerbose,
} from "../internal/logger";
import type { DocsConfig, DocsGroup, ProductInfo } from "../llm";
import {
  generateAgentReadabilityArtifacts,
  generateAgentsMd,
  generateLLMFullContextFiles,
  generateLlmsTxt,
  resolveDocsNavigation,
} from "../llm";
import { defaultRemarkPlugins } from "../remark";
import type { GenerateDocsSearchFilesResult } from "../search/node";
import { generateDocsSearchFiles } from "../search/node";

const DEFAULT_DOCS_DIR = "docs";
const DEFAULT_OUT_DIR = "public";
const DOCS_CONFIG_FILENAMES = [
  "docs.config.ts",
  "docs.config.js",
  "docs.config.mjs",
  "docs.config.cjs",
] as const;
const GROUP_SEPARATOR_PATTERN = /[-_]+/g;
const INFER_GROUPS_READ_BATCH_SIZE = 32;
const TITLE_CASE_PATTERN = /\b\w/g;
const FORMAT_VALUES = new Set(["text", "json"]);

type GenerateFormat = "json" | "text";

export type GenerateArgs = {
  baseUrl?: string;
  bundle: boolean;
  docsDir: string;
  enrichGit: boolean;
  exclude: string[];
  format: GenerateFormat;
  help: boolean;
  include: string[];
  name?: string;
  outDir: string;
  srcDir: string;
  summary?: string;
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
  files: {
    agentsMd?: string;
    agentReadabilityManifest?: string;
    docsRobotsTxt?: string;
    docsSitemapMd?: string;
    docsSitemapXml?: string;
    docsLlmsTxt?: string;
    llmsFullTxt?: string;
    llmsTxt?: string;
    searchContent?: string;
    searchIndex?: string;
  };
  groups: DocsGroup[];
  filters: GenerateFilters;
  mode: "site" | "bundle";
  outDir: string;
  product: ProductInfo;
  search?: GenerateDocsSearchFilesResult;
  srcDir: string;
};

type LoadedDocsConfig = {
  config: DocsConfig;
  path: string;
};

type ResolvedGenerateMetadata = {
  configPath?: string;
  groups: DocsGroup[];
  product: ProductInfo;
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
  --docs-dir <dir>   Docs folder relative to --src (default: docs)
  --out <dir>        Output root directory (default: public)
  --bundle           Bundle mode for npm packages (AGENTS.md + docs/*.md)
  --base-url <url>   Base URL for generated links (site mode)
  --name <name>      Product name for generated index files
  --summary <text>   Product summary for generated index files
  --include <glob>   Include MDX paths matching this docs-root-relative glob
  --exclude <glob>   Exclude MDX paths matching this docs-root-relative glob
  --enrich-git       Add lastModified and lastAuthor from git history
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
    docsDir: DEFAULT_DOCS_DIR,
    enrichGit: false,
    exclude: [],
    format: "text",
    help: false,
    include: [],
    outDir: DEFAULT_OUT_DIR,
    srcDir: ".",
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--src") {
      args.srcDir = readValue(argv, ++i, "--src");
    } else if (arg === "--docs-dir") {
      args.docsDir = readValue(argv, ++i, "--docs-dir");
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
  const groups = validateDocsGroups(value.groups);
  if (!groups) {
    throw new Error(
      `docs config at "${configPath}" must export groups as an array of { slug, title } entries`
    );
  }
  return { groups, product };
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

async function loadDocsConfig(
  docsDir: string
): Promise<LoadedDocsConfig | null> {
  const configPath = DOCS_CONFIG_FILENAMES.map((filename) =>
    path.join(docsDir, filename)
  ).find((candidate) => existsSync(candidate));

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

async function resolveGenerateMetadata(
  srcDir: string,
  docsDir: string,
  args: GenerateArgs
): Promise<ResolvedGenerateMetadata> {
  const loadedConfig = await loadDocsConfig(docsDir);
  if (loadedConfig) {
    return {
      configPath: loadedConfig.path,
      groups: loadedConfig.config.groups,
      product: applyProductOverrides(loadedConfig.config.product, args),
    };
  }

  return {
    groups: await inferGroups(docsDir),
    product: await readPackageProduct(srcDir, args),
  };
}

async function createSourceMirror(
  srcDir: string,
  docsDir: string,
  args: GenerateArgs
): Promise<SourceMirror> {
  const filters = {
    exclude: [...args.exclude],
    include: [...args.include],
  };
  const hasFilters = filters.include.length > 0 || filters.exclude.length > 0;

  if (path.normalize(args.docsDir) === DEFAULT_DOCS_DIR && !hasFilters) {
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

  if (hasFilters) {
    const patterns =
      filters.include.length > 0 ? filters.include : ["**/*.mdx"];
    const files = await fg(patterns, {
      absolute: false,
      cwd: docsDir,
      ignore: filters.exclude,
      onlyFiles: true,
    });
    const mdxFiles = files
      .filter((file) => file.endsWith(".mdx"))
      .sort((left, right) => left.localeCompare(right));

    if (mdxFiles.length === 0) {
      await rm(tempRoot, { force: true, recursive: true });
      throw new Error(
        "No MDX files matched the provided include/exclude filters"
      );
    }

    await Promise.all(
      mdxFiles.map(async (file) => {
        const sourcePath = path.join(docsDir, file);
        const targetPath = path.join(tempDocsDir, file);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await cp(sourcePath, targetPath);
      })
    );
  } else {
    await cp(docsDir, tempDocsDir, {
      recursive: true,
    });
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
  const docsDir = path.resolve(srcDir, args.docsDir);
  const outDir = path.resolve(args.outDir);

  if (!existsSync(docsDir)) {
    if (args.format === "json") {
      logger.error({
        human: { message: `docs directory not found at ${docsDir}` },
        json: {
          event: "generate.docs_not_found",
          fields: { error: "docs directory not found", path: docsDir },
        },
      });
    } else {
      io.stderr.write(
        `leadtype generate: docs directory not found at ${docsDir}\n`
      );
    }
    return 1;
  }

  let sourceMirror: SourceMirror | undefined;
  try {
    const metadata = await resolveGenerateMetadata(srcDir, docsDir, args);
    sourceMirror = await createSourceMirror(srcDir, docsDir, args);
    const { groups, product } = metadata.configPath
      ? metadata
      : {
          ...metadata,
          groups: await inferGroups(sourceMirror.docsDir),
        };

    const navigation = await resolveDocsNavigation({
      srcDir: sourceMirror.srcDir,
      groups,
    });
    const firstUnknownGroup = navigation.unknown[0];
    if (firstUnknownGroup) {
      throw new Error(
        `${firstUnknownGroup.urlPath} declares unknown group "${firstUnknownGroup.slug}"`
      );
    }

    await convertAllMdx({
      srcDir: sourceMirror.docsDir,
      outDir: path.join(outDir, "docs"),
      remarkPlugins: [...defaultRemarkPlugins],
      enrichFrontmatterFromGit: args.enrichGit,
    });

    let result: GenerateResult;
    if (args.bundle) {
      const agents = await generateAgentsMd({
        srcDir: sourceMirror.srcDir,
        outDir,
        product,
        groups,
      });
      result = {
        docsDir,
        files: { agentsMd: agents.outputPath },
        filters: sourceMirror.filters,
        groups,
        mode: "bundle",
        outDir,
        product,
        srcDir,
      };
    } else {
      await generateLlmsTxt({
        srcDir: sourceMirror.srcDir,
        outDir,
        baseUrl: args.baseUrl,
        product,
        groups,
      });

      await generateLLMFullContextFiles({
        outDir,
        baseUrl: args.baseUrl,
        product: { name: product.name },
        groups,
      });

      const search = await generateDocsSearchFiles({
        outDir,
        baseUrl: args.baseUrl,
      });
      const agentReadability = await generateAgentReadabilityArtifacts({
        outDir,
        baseUrl: args.baseUrl,
        product,
        groups,
      });

      result = {
        docsDir,
        files: {
          agentReadabilityManifest: agentReadability.files.manifest,
          docsRobotsTxt: agentReadability.files.robotsTxt,
          docsSitemapMd: agentReadability.files.sitemapMd,
          docsSitemapXml: agentReadability.files.sitemapXml,
          docsLlmsTxt: path.join(outDir, "docs", "llms.txt"),
          llmsFullTxt: path.join(outDir, "llms-full.txt"),
          llmsTxt: path.join(outDir, "llms.txt"),
          searchContent: search.contentOutputPath,
          searchIndex: search.outputPath,
        },
        filters: sourceMirror.filters,
        groups,
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
    if (args.format === "json") {
      logger.error({
        human: { message },
        json: {
          event: "generate.fail",
          fields: {
            error: message,
            filters: {
              exclude: args.exclude,
              include: args.include,
            },
          },
        },
      });
    } else {
      io.stderr.write(`leadtype generate: ${message}\n`);
    }
    return 1;
  } finally {
    await sourceMirror?.cleanup();
  }
  return 0;
}
