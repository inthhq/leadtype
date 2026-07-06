#!/usr/bin/env node
import { resolve } from "node:path";
import type { PluggableList } from "unified";
import { loadLeadtypeConfig } from "../cli/generate";
import { setLogFormat, setVerbose } from "../internal/logger";
import { getFlattenerNames } from "../internal/remark-phase";
import { resolveAllCollections } from "../sync/sync";
import { type ReporterFormat, renderReport } from "./reporters";
import {
  DEFAULT_IGNORE_GLOBS,
  type LintResult,
  type LintSeverity,
  type LintViolation,
  lintDocs,
} from "./runner";

const DEFAULT_IGNORE_GLOBS_TEXT = DEFAULT_IGNORE_GLOBS.join(", ");
const STDOUT_FORMATS = new Set<ReporterFormat>(["github", "json"]);

type CliArgs = {
  srcDir: string;
  changelogDir?: string;
  format: ReporterFormat;
  ignore: string[];
  unknownFieldSeverity: LintSeverity;
  maxWarnings: number;
  help: boolean;
  verbose: boolean;
};

export type LintCliIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

const USAGE = `leadtype lint — validate MDX frontmatter and meta.json against a schema

Usage:
  leadtype lint [srcDir] [options]

Options:
  --src <dir>              Source directory (default: ./content)
  --changelog <dir>        Subdirectory that uses the changelog schema
  --format <fmt>           pretty | json | github (default: pretty)
  --ignore <glob>          Glob to skip (repeatable). Default: ${DEFAULT_IGNORE_GLOBS_TEXT}
  --warn-unknown           Unknown fields warn (default)
  --error-unknown          Unknown fields error
  --max-warnings <n>       Exit non-zero if warnings exceed n (default: Infinity)
  -v, --verbose            Print extra progress events to stderr
  -h, --help               Show this help

Exit codes:
  0  No errors (warnings under --max-warnings)
  1  Errors present or warnings exceeded
  2  CLI usage error
`;

export function getLintUsage(): string {
  return USAGE;
}

export function parseLintArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    srcDir: "content",
    format: "pretty",
    ignore: [],
    unknownFieldSeverity: "warn",
    maxWarnings: Number.POSITIVE_INFINITY,
    help: false,
    verbose: false,
  };
  let positional = 0;
  const readValue = (argv_: string[], index: number, flag: string): string => {
    const value = argv_[index];
    // Guard against flag-like tokens so `--src --format json` surfaces as a
    // usage error instead of silently consuming `--format` as the src dir.
    if (!value || value.startsWith("-")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--src") {
      args.srcDir = readValue(argv, ++i, "--src");
    } else if (arg === "--changelog") {
      args.changelogDir = readValue(argv, ++i, "--changelog");
    } else if (arg === "--format") {
      const value = readValue(argv, ++i, "--format");
      if (value !== "pretty" && value !== "json" && value !== "github") {
        throw new Error(`--format must be pretty|json|github, got ${value}`);
      }
      args.format = value;
    } else if (arg === "--ignore") {
      args.ignore.push(readValue(argv, ++i, "--ignore"));
    } else if (arg === "--warn-unknown") {
      args.unknownFieldSeverity = "warn";
    } else if (arg === "--error-unknown") {
      args.unknownFieldSeverity = "error";
    } else if (arg === "--max-warnings") {
      const value = readValue(argv, ++i, "--max-warnings");
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error("--max-warnings must be a non-negative integer");
      }
      args.maxWarnings = parsed;
    } else if (arg === "--verbose" || arg === "-v") {
      args.verbose = true;
    } else if (arg && !arg.startsWith("-")) {
      if (positional === 0) {
        args.srcDir = arg;
      } else {
        throw new Error(`unexpected positional argument: ${arg}`);
      }
      positional += 1;
    } else if (arg) {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  if (args.ignore.length === 0) {
    args.ignore = [...DEFAULT_IGNORE_GLOBS];
  }
  return args;
}

export async function runLintCommand(
  argv: string[],
  io: LintCliIo = { stderr: process.stderr, stdout: process.stdout }
): Promise<number> {
  let args: CliArgs;
  try {
    args = parseLintArgs(argv);
  } catch (error) {
    io.stderr.write(`${String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    io.stdout.write(USAGE);
    return 0;
  }

  setLogFormat("human");
  setVerbose(false);
  if (args.format === "json") {
    setLogFormat("json");
  }
  if (args.verbose) {
    setVerbose(true);
  }

  const resolvedSrcDir = resolve(args.srcDir);

  // Look for the project-level leadtype.config.* under the user's --src so a
  // monorepo invocation like `leadtype lint --src packages/foo` lints that
  // package's collections rather than the repo-root project.
  const projectConfig = await loadLeadtypeConfig(resolvedSrcDir);
  const collections = projectConfig?.config.collections;

  // Custom-flattener component names, so the `unflattened-component` rule
  // doesn't warn on components the project has actually wired a flattener for.
  const knownComponentSet = new Set<string>();
  const addFlattenerNames = (plugins?: PluggableList): void => {
    for (const entry of plugins ?? []) {
      for (const name of getFlattenerNames(entry)) {
        knownComponentSet.add(name);
      }
    }
  };
  addFlattenerNames(projectConfig?.config.flatteners);
  for (const collection of Object.values(collections ?? {})) {
    addFlattenerNames(collection.flatteners);
  }
  const knownComponents = [...knownComponentSet];

  let result: LintResult;
  if (collections && Object.keys(collections).length > 0) {
    const configDir = resolve(projectConfig.path, "..");
    const resolved = resolveAllCollections(collections, configDir);
    const combined: LintViolation[] = [];
    let filesScanned = 0;
    let errors = 0;
    let warnings = 0;
    for (const entry of resolved) {
      io.stderr.write(
        `Linting collection [${entry.key}] at ${entry.absoluteDir}\n`
      );
      const each = await lintDocs({
        srcDir: entry.absoluteDir,
        ignore: args.ignore,
        unknownFieldSeverity: args.unknownFieldSeverity,
        knownComponents,
        schemas: entry.collection.schema
          ? { frontmatter: entry.collection.schema }
          : undefined,
      });
      for (const violation of each.violations) {
        combined.push({
          ...violation,
          message: `[collection:${entry.key}] ${violation.message}`,
        });
      }
      filesScanned += each.summary.filesScanned;
      errors += each.summary.errors;
      warnings += each.summary.warnings;
    }
    result = {
      violations: combined,
      summary: { filesScanned, errors, warnings },
    };
  } else {
    result = await lintDocs({
      srcDir: resolvedSrcDir,
      changelogDir: args.changelogDir
        ? resolve(resolvedSrcDir, args.changelogDir)
        : undefined,
      ignore: args.ignore,
      unknownFieldSeverity: args.unknownFieldSeverity,
      knownComponents,
    });
  }

  const output = renderReport(args.format, result);
  // Machine-readable formats go to stdout so they can be piped; the pretty
  // format goes to stderr so stdout stays clean when scripts mix formats.
  if (STDOUT_FORMATS.has(args.format)) {
    io.stdout.write(output);
  } else {
    io.stderr.write(output);
  }

  const exceedsWarnings = result.summary.warnings > args.maxWarnings;
  return result.summary.errors > 0 || exceedsWarnings ? 1 : 0;
}
