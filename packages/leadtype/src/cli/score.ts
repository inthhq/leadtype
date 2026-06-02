import { type ScoreResult, scoreDocs } from "../score/score";

export type ScoreCliIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

export type ScoreCliArgs = {
  srcDir: string;
  outDir: string;
  format: "json" | "pretty";
  min?: number;
  help: boolean;
};

const SCORE_USAGE = `leadtype score — agent-readiness score for a generated docs build

Usage:
  leadtype score [options]

Scores the leadtype-addressable agent readiness of your generated output, mapped to
the ora rubric (https://ora.ai/score), so you can coach toward a high external scan.
It scores what leadtype emits + your doc structure — a local proxy, not live
answer-engine ranking. Run \`leadtype generate\` first.

Options:
  --out <dir>     Generated output root to inspect (default: ./public)
  --src <dir>     Docs source root for the structure check (default: ./docs)
  --format <fmt>  pretty | json (default: pretty)
  --json          Alias for --format json
  --min <n>       Exit non-zero if the score is below n (for CI gates)
  -h, --help      Show this help

Exit codes:
  0  Scored (and at/above --min if set)
  1  Score below --min
  2  CLI usage error
`;

export function getScoreUsage(): string {
  return SCORE_USAGE;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseScoreArgs(argv: string[]): ScoreCliArgs {
  const args: ScoreCliArgs = {
    srcDir: "./docs",
    outDir: "./public",
    format: "pretty",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--out") {
      args.outDir = readValue(argv, ++i, "--out");
    } else if (arg === "--src") {
      args.srcDir = readValue(argv, ++i, "--src");
    } else if (arg === "--format") {
      const value = readValue(argv, ++i, "--format");
      if (value !== "pretty" && value !== "json") {
        throw new Error("--format must be pretty or json");
      }
      args.format = value;
    } else if (arg === "--json") {
      args.format = "json";
    } else if (arg === "--min") {
      const raw = readValue(argv, ++i, "--min");
      const min = Number.parseInt(raw, 10);
      if (!Number.isFinite(min)) {
        // A NaN min would make the `score < min` gate always pass, silently
        // disabling the CI threshold it was meant to enforce.
        throw new Error(`--min must be a number (got "${raw}")`);
      }
      args.min = min;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return args;
}

function renderPretty(result: ScoreResult): string {
  const lines: string[] = [];
  lines.push(`Agent readiness (leadtype-addressable)   ${result.score}/100`);
  lines.push("");
  for (const dim of result.dimensions) {
    if (dim.inLane) {
      lines.push(`${dim.label}   ${dim.points}/${dim.max}`);
      for (const s of dim.signals) {
        const mark = s.points >= s.max ? "✓" : "✗";
        const fix = s.points < s.max && s.fix ? ` — ${s.fix}` : "";
        lines.push(`  ${mark} ${s.label}${fix}`);
      }
      lines.push("");
    }
  }
  const excluded = result.dimensions.filter((d) => !d.inLane);
  if (excluded.length > 0) {
    lines.push("Not leadtype's lane (excluded from the score):");
    for (const dim of excluded) {
      lines.push(`  • ${dim.label} — ${dim.note ?? ""}`);
    }
    lines.push("");
  }
  if (result.fixes.length > 0) {
    lines.push("Top fixes:");
    for (const fix of result.fixes.slice(0, 5)) {
      lines.push(`  • ${fix}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function runScoreCommand(
  argv: string[],
  io: ScoreCliIo
): Promise<number> {
  let args: ScoreCliArgs;
  try {
    args = parseScoreArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n\n${SCORE_USAGE}`);
    return 2;
  }

  if (args.help) {
    io.stdout.write(SCORE_USAGE);
    return 0;
  }

  const result = await scoreDocs({ outDir: args.outDir, srcDir: args.srcDir });

  if (args.format === "json") {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout.write(renderPretty(result));
  }

  if (args.min !== undefined && result.score < args.min) {
    io.stderr.write(`score ${result.score} is below --min ${args.min}\n`);
    return 1;
  }
  return 0;
}
