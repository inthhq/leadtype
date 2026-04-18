#!/usr/bin/env node
import { resolve } from "node:path";
import { type ReporterFormat, renderReport } from "./reporters";
import { DEFAULT_IGNORE_GLOBS, type LintSeverity, lintDocs } from "./runner";

type CliArgs = {
  srcDir: string;
  changelogDir?: string;
  format: ReporterFormat;
  ignore: string[];
  unknownFieldSeverity: LintSeverity;
  maxWarnings: number;
  help: boolean;
};

const USAGE = `inth-docs-lint — validate MDX frontmatter and meta.json against a schema

Usage:
  inth-docs-lint [srcDir] [options]

Options:
  --src <dir>              Source directory (default: ./content)
  --changelog <dir>        Subdirectory that uses the changelog schema
  --format <fmt>           pretty | json | github (default: pretty)
  --ignore <glob>          Glob to skip (repeatable). Default: shared/**, _partials/**
  --warn-unknown           Unknown fields warn (default)
  --error-unknown          Unknown fields error
  --max-warnings <n>       Exit non-zero if warnings exceed n (default: Infinity)
  -h, --help               Show this help

Exit codes:
  0  No errors (warnings under --max-warnings)
  1  Errors present or warnings exceeded
  2  CLI usage error
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    srcDir: "content",
    format: "pretty",
    ignore: [],
    unknownFieldSeverity: "warn",
    maxWarnings: Number.POSITIVE_INFINITY,
    help: false,
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

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${String(error)}\n\n${USAGE}`);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const resolvedSrcDir = resolve(args.srcDir);
  const result = await lintDocs({
    srcDir: resolvedSrcDir,
    // Resolve changelog against the source root so `--changelog changelog`
    // points inside the src tree, not inside the process cwd.
    changelogDir: args.changelogDir
      ? resolve(resolvedSrcDir, args.changelogDir)
      : undefined,
    ignore: args.ignore,
    unknownFieldSeverity: args.unknownFieldSeverity,
  });

  const output = renderReport(args.format, result);
  // Machine-readable formats go to stdout so they can be piped; the pretty
  // format goes to stderr so stdout stays clean when scripts mix formats.
  const STDOUT_FORMATS = new Set(["github", "json"]);
  if (STDOUT_FORMATS.has(args.format)) {
    process.stdout.write(output);
  } else {
    process.stderr.write(output);
  }

  const exceedsWarnings = result.summary.warnings > args.maxWarnings;
  process.exit(result.summary.errors > 0 || exceedsWarnings ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`docs-lint: ${String(error)}\n`);
  process.exit(1);
});
