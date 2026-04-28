import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import { convertAllMdx } from "../convert";
import type { DocsGroup, ProductInfo } from "../llm";
import { generateLLMFullContextFiles, generateLlmsTxt } from "../llm";
import { defaultRemarkPlugins } from "../remark";
import type { GenerateDocsSearchFilesResult } from "../search/node";
import { generateDocsSearchFiles } from "../search/node";

const DEFAULT_DOCS_DIR = "docs";
const DEFAULT_OUT_DIR = "public";
const GROUP_SEPARATOR_PATTERN = /[-_]+/g;
const TITLE_CASE_PATTERN = /\b\w/g;
const FORMAT_VALUES = new Set(["text", "json"]);

type GenerateFormat = "json" | "text";

export type GenerateArgs = {
  baseUrl?: string;
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
    docsLlmsFullTxt: string;
    docsLlmsTxt: string;
    llmsTxt: string;
    searchContent?: string;
    searchIndex: string;
  };
  groups: DocsGroup[];
  filters: GenerateFilters;
  outDir: string;
  product: ProductInfo;
  search: GenerateDocsSearchFilesResult;
  srcDir: string;
};

const GENERATE_USAGE = `@inth/docs generate — convert MDX, generate LLM files, and build search artifacts

Usage:
  @inth/docs generate [options]

Options:
  --src <dir>        Source repo/root directory (default: .)
  --docs-dir <dir>   Docs folder relative to --src (default: docs)
  --out <dir>        Output root directory (default: public)
  --base-url <url>   Base URL for generated links
  --name <name>      Product name for generated LLM files
  --summary <text>   Product summary for generated LLM files
  --include <glob>   Include MDX paths matching this docs-root-relative glob
  --exclude <glob>   Exclude MDX paths matching this docs-root-relative glob
  --enrich-git       Add lastModified and lastAuthor from git history
  --format <fmt>     text | json (default: text)
  --json             Alias for --format json
  -h, --help         Show this help
`;

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseGenerateArgs(argv: string[]): GenerateArgs {
  const args: GenerateArgs = {
    docsDir: DEFAULT_DOCS_DIR,
    enrichGit: false,
    exclude: [],
    format: "text",
    help: false,
    include: [],
    outDir: DEFAULT_OUT_DIR,
    srcDir: ".",
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
    } else if (arg === "--format") {
      const value = readValue(argv, ++i, "--format");
      if (!FORMAT_VALUES.has(value)) {
        throw new Error(`--format must be text|json, got ${value}`);
      }
      args.format = value as GenerateFormat;
    } else if (arg === "--json") {
      args.format = "json";
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

  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const parsed = matter(raw);
    for (const slug of normalizeGroupValues(parsed.data.group)) {
      const trimmed = slug.trim();
      if (trimmed.length > 0) {
        slugs.add(trimmed);
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

  const tempRoot = await mkdtemp(path.join(tmpdir(), "inth-docs-generate-"));
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

  const srcDir = path.resolve(args.srcDir);
  const docsDir = path.resolve(srcDir, args.docsDir);
  const outDir = path.resolve(args.outDir);

  if (!existsSync(docsDir)) {
    if (args.format === "json") {
      io.stderr.write(
        `${JSON.stringify(
          {
            error: "docs directory not found",
            path: docsDir,
          },
          null,
          2
        )}\n`
      );
    } else {
      io.stderr.write(
        `@inth/docs generate: docs directory not found at ${docsDir}\n`
      );
    }
    return 1;
  }

  const product = await readPackageProduct(srcDir, args);
  let sourceMirror: SourceMirror;
  try {
    sourceMirror = await createSourceMirror(srcDir, docsDir, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.format === "json") {
      io.stderr.write(
        `${JSON.stringify(
          {
            error: message,
            filters: {
              exclude: args.exclude,
              include: args.include,
            },
          },
          null,
          2
        )}\n`
      );
    } else {
      io.stderr.write(`@inth/docs generate: ${message}\n`);
    }
    return 1;
  }
  const groups = await inferGroups(sourceMirror.docsDir);

  try {
    await convertAllMdx({
      srcDir: sourceMirror.docsDir,
      outDir: path.join(outDir, "docs"),
      remarkPlugins: defaultRemarkPlugins,
      enrichFrontmatterFromGit: args.enrichGit,
    });

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

    const result: GenerateResult = {
      docsDir,
      files: {
        docsLlmsFullTxt: path.join(outDir, "docs", "llms-full.txt"),
        docsLlmsTxt: path.join(outDir, "docs", "llms.txt"),
        llmsTxt: path.join(outDir, "llms.txt"),
        searchContent: search.contentOutputPath,
        searchIndex: search.outputPath,
      },
      filters: sourceMirror.filters,
      groups,
      outDir,
      product,
      search,
      srcDir,
    };

    if (args.format === "json") {
      io.stdout.write(`${renderGenerateResult(result)}\n`);
    } else {
      io.stdout.write(`Generated docs pipeline output in ${outDir}\n`);
    }
  } finally {
    await sourceMirror.cleanup();
  }
  return 0;
}
