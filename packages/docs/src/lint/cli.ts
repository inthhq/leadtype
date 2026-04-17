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
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--src") {
      const value = argv[++i];
      if (!value) {
        throw new Error("--src requires a value");
      }
      args.srcDir = value;
    } else if (arg === "--changelog") {
      const value = argv[++i];
      if (!value) {
        throw new Error("--changelog requires a value");
      }
      args.changelogDir = value;
    } else if (arg === "--format") {
      const value = argv[++i];
      if (value !== "pretty" && value !== "json" && value !== "github") {
        throw new Error(`--format must be pretty|json|github, got ${value}`);
      }
      args.format = value;
    } else if (arg === "--ignore") {
      const value = argv[++i];
      if (!value) {
        throw new Error("--ignore requires a value");
      }
      args.ignore.push(value);
    } else if (arg === "--warn-unknown") {
      args.unknownFieldSeverity = "warn";
    } else if (arg === "--error-unknown") {
      args.unknownFieldSeverity = "error";
    } else if (arg === "--max-warnings") {
      const value = argv[++i];
      if (!value) {
        throw new Error("--max-warnings requires a value");
      }
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

  const result = await lintDocs({
    srcDir: resolve(args.srcDir),
    changelogDir: args.changelogDir ? resolve(args.changelogDir) : undefined,
    ignore: args.ignore,
    unknownFieldSeverity: args.unknownFieldSeverity,
  });

  const output = renderReport(args.format, result);
  if (args.format === "github") {
    process.stdout.write(output);
  } else if (args.format === "json") {
    process.stdout.write(output);
  } else {
    // Pretty goes to stderr so JSON piping via stdout stays clean when scripts
    // mix and match.
    process.stderr.write(output);
  }

  const exceedsWarnings = result.summary.warnings > args.maxWarnings;
  process.exit(result.summary.errors > 0 || exceedsWarnings ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`docs-lint: ${String(error)}\n`);
  process.exit(1);
});
