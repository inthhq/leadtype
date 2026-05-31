#!/usr/bin/env bun
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateway, generateText, stepCountIs } from "ai";
import { aggregateRun } from "./lib/aggregate";
import {
  DEFAULT_JUDGE_MODEL,
  type JudgeArtifact,
  judgeAnswer,
} from "./lib/judge";
import { namespaceModelId, parseModelList, providerFor } from "./lib/models";
import { summarizePackageReads } from "./lib/package-metrics";
import { runPool } from "./lib/pool";
import type { RunRecord } from "./lib/record";
import { withRetry } from "./lib/retry";
import { createSandbox } from "./lib/sandbox";
import { scopedTools } from "./lib/tools";
import type { Mode, ToolCall, Transcript } from "./lib/transcript";

const evalsRoot = fileURLToPath(new URL(".", import.meta.url));
const fixturesRoot = path.join(evalsRoot, "evals");

const SYSTEM_PROMPT = `You are an expert coding agent working inside a project that depends on the npm package \`leadtype\`. The project root is your working directory; every tool path is relative to it. You have a small set of tools — read, write, list, glob, grep, and a narrow npm tool that supports only \`pack\` and \`install\`. There is no shell.

Solve the user's task as you normally would: explore relevant files first, then make the changes. When the task asks you to verify a result (e.g. with \`npm pack --dry-run\`), use the npm tool. When you are done, write a short final summary describing what you did.`;

const STEP_LIMIT = 50;
const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_JUDGE_ARTIFACTS = 12;
const MODEL_TIMEOUT_MS = 180_000;

type CliArgs = {
  fixture?: string;
  modes?: Mode[];
  models: string[];
  judge: string;
  runs: number;
  label?: string;
  concurrency: number;
};

const ALL_MODES: Mode[] = ["treatment", "control", "pointer"];
const DEFAULT_MODES: Mode[] = ["treatment", "control"];

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer, got ${value}`);
  }
  return Number(value);
}

function parseRequiredFlagValue(
  value: string | undefined,
  flag: string
): string {
  if (!value || /^-(?!\d)/.test(value)) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseModes(value: string | undefined): Mode[] {
  const raw = parseRequiredFlagValue(value, "--mode");
  const modes = raw
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  for (const m of modes) {
    if (!ALL_MODES.includes(m as Mode)) {
      throw new Error(`--mode must be ${ALL_MODES.join("|")}, got ${m}`);
    }
  }
  return [...new Set(modes)] as Mode[];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat CLI flag switch is clearer left inline than split apart
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    models: [DEFAULT_MODEL],
    judge: DEFAULT_JUDGE_MODEL,
    runs: 1,
    concurrency: 1,
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    i++;
    if (a === "--fixture") {
      args.fixture = parseRequiredFlagValue(argv[i++], "--fixture");
    } else if (a === "--mode") {
      args.modes = parseModes(argv[i++]);
    } else if (a === "--model" || a === "--models") {
      args.models = parseModelList(parseRequiredFlagValue(argv[i++], a));
    } else if (a === "--judge") {
      args.judge = parseRequiredFlagValue(argv[i++], "--judge");
    } else if (a === "--runs") {
      args.runs = parsePositiveInt(argv[i++], "--runs");
    } else if (a === "--concurrency") {
      args.concurrency = parsePositiveInt(argv[i++], "--concurrency");
    } else if (a === "--label") {
      args.label = parseRequiredFlagValue(argv[i++], "--label");
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else if (a) {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return args;
}

function printUsage(): void {
  process.stdout.write(`Usage: bun run run-eval.ts [options]

Options:
  --fixture <name>   Run only one fixture (default: all)
  --mode <a,b>       Arms to run: treatment|control|pointer (default: treatment,control)
  --models <a,b,c>   Comma-separated candidate model ids (default: ${DEFAULT_MODEL})
  --model <id>       Alias for a single --models entry
  --judge <id>       Judge model id (default: ${DEFAULT_JUDGE_MODEL})
  --runs <n>         Repetitions per (fixture × mode × model) (default: 1)
  --concurrency <n>  Number of runs in flight at once (default: 1)
  --label <name>     Results folder name under results/package/ (default: timestamp)
  -h, --help         Show this help
`);
}

function discoverFixtures(): string[] {
  if (!existsSync(fixturesRoot)) {
    return [];
  }
  return readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(path.join(fixturesRoot, name, "PROMPT.md")))
    .sort();
}

async function collectArtifacts(
  tempDir: string,
  filesModified: string[]
): Promise<JudgeArtifact[]> {
  const artifacts: JudgeArtifact[] = [];
  for (const rel of filesModified) {
    if (artifacts.length >= MAX_JUDGE_ARTIFACTS) {
      break;
    }
    if (rel.includes("node_modules") || rel.endsWith("package-lock.json")) {
      continue;
    }
    try {
      const content = await readFile(path.join(tempDir, rel), "utf-8");
      artifacts.push({ path: rel, content });
    } catch {
      // File vanished or unreadable — skip.
    }
  }
  return artifacts;
}

async function runOne(options: {
  fixture: string;
  mode: Mode;
  modelId: string;
  judge: string;
  runIndex: number;
  totalRuns: number;
  runDir: string;
  promptText: string;
  rubricText: string;
}): Promise<RunRecord> {
  const {
    fixture,
    mode,
    modelId,
    judge,
    runIndex,
    totalRuns,
    runDir,
    promptText,
    rubricText,
  } = options;
  const fixtureDir = path.join(fixturesRoot, fixture);

  process.stdout.write(
    `▶ ${fixture} / ${mode} / ${modelId} [${runIndex}/${totalRuns}]\n`
  );

  const sandbox = await createSandbox({ fixtureDir, mode });
  const start = Date.now();
  const transcriptCalls: ToolCall[] = [];
  const filesModified = new Set<string>();
  const tools = scopedTools({
    tempDir: sandbox.tempDir,
    transcript: transcriptCalls,
    filesModified,
  });

  const provider = providerFor(modelId);
  const errors: string[] = [];
  let finalText = "";
  let steps = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const result = await withRetry(() =>
      generateText({
        model: gateway(namespaceModelId(modelId)),
        system: SYSTEM_PROMPT,
        prompt: promptText,
        tools,
        stopWhen: stepCountIs(STEP_LIMIT),
        timeout: MODEL_TIMEOUT_MS,
      })
    );
    finalText = result.text ?? "";
    steps = result.steps?.length ?? 0;
    inputTokens = result.usage?.inputTokens ?? 0;
    outputTokens = result.usage?.outputTokens ?? 0;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const durationMs = Date.now() - start;
  const modifiedList = [...filesModified].sort();
  const transcript: Transcript = {
    fixture,
    benchmark: "package",
    mode,
    agent: { provider, model: modelId },
    toolCalls: transcriptCalls,
    filesModified: modifiedList,
    finalText,
    durationMs,
    steps,
    errors,
    tokens: { input: inputTokens, output: outputTokens },
  };

  const artifacts = await collectArtifacts(sandbox.tempDir, modifiedList);
  const verdict = await judgeAnswer({
    task: promptText,
    rubric: rubricText,
    answer: finalText,
    artifacts,
    judgeModel: judge,
  });

  const { discoveredAgentsMd, readBundledDocs, usedBundle } =
    summarizePackageReads(transcriptCalls);

  const record: RunRecord = {
    benchmark: "package",
    fixture,
    model: modelId,
    runIndex,
    mode,
    passed: verdict.correct,
    score: verdict.score,
    judgeModel: verdict.judgeModel,
    judgeReasoning: verdict.reasoning,
    judgeError: verdict.error,
    failureMode: verdict.failureMode,
    discoveredAgentsMd,
    readBundledDocs,
    usedBundle,
    toolCalls: transcriptCalls.length,
    inputTokens,
    outputTokens,
    durationMs,
    steps,
    errors,
  };

  await archiveRun({
    runDir,
    fixture,
    arm: mode,
    modelId,
    runIndex,
    tempDir: sandbox.tempDir,
    transcript,
    verdict,
    record,
    artifacts,
  });
  await sandbox.cleanup();

  process.stdout.write(
    `  ${verdict.correct ? "✓" : "✗"} score ${verdict.score} · ${(durationMs / 1000).toFixed(1)}s · ${transcriptCalls.length} calls${
      discoveredAgentsMd ? " · read AGENTS.md" : ""
    }${verdict.error ? " · JUDGE ERROR" : ""}\n`
  );
  for (const e of errors) {
    process.stdout.write(`    ! ${e}\n`);
  }
  return record;
}

async function archiveRun(opts: {
  runDir: string;
  fixture: string;
  arm: string;
  modelId: string;
  runIndex: number;
  tempDir: string;
  transcript: Transcript;
  verdict: Awaited<ReturnType<typeof judgeAnswer>>;
  record: RunRecord;
  artifacts: JudgeArtifact[];
}): Promise<void> {
  const dir = path.join(
    opts.runDir,
    "runs",
    opts.fixture,
    opts.arm,
    sanitizeSegment(opts.modelId),
    `run-${opts.runIndex}`
  );
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "transcript.json"),
    `${JSON.stringify(opts.transcript, null, 2)}\n`
  );
  await writeFile(
    path.join(dir, "judge.json"),
    `${JSON.stringify(opts.verdict, null, 2)}\n`
  );
  await writeFile(
    path.join(dir, "record.json"),
    `${JSON.stringify(opts.record, null, 2)}\n`
  );
  for (const file of opts.artifacts) {
    const dest = path.join(dir, "files", file.path);
    const filesDir = path.join(dir, "files");
    const relativeDest = path.relative(filesDir, dest);
    if (relativeDest.startsWith("..") || path.isAbsolute(relativeDest)) {
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, file.content);
  }
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const allFixtures = discoverFixtures();
  if (allFixtures.length === 0) {
    process.stderr.write(`No fixtures found under ${fixturesRoot}\n`);
    process.exit(1);
  }
  const fixtures = args.fixture
    ? [args.fixture].filter((f) => allFixtures.includes(f))
    : allFixtures;
  if (fixtures.length === 0) {
    process.stderr.write(`Fixture not found: ${args.fixture}\n`);
    process.exit(1);
  }
  const modes: Mode[] = args.modes ?? DEFAULT_MODES;

  const runId = args.label ?? new Date().toISOString().replace(/[.:]/g, "-");
  const runDir = path.join(evalsRoot, "results", "package", runId);
  await mkdir(runDir, { recursive: true });

  const total = fixtures.length * modes.length * args.models.length * args.runs;
  process.stdout.write(
    `Package benchmark: ${fixtures.length} fixtures × ${modes.length} modes × ${args.models.length} models × ${args.runs} runs = ${total} agent runs\nJudge: ${args.judge} · concurrency: ${args.concurrency}\nResults: ${runDir}\n\n`
  );

  // Prefetch prompt + rubric per fixture once.
  const fixtureText = new Map<string, { prompt: string; rubric: string }>();
  for (const fixture of fixtures) {
    const dir = path.join(fixturesRoot, fixture);
    fixtureText.set(fixture, {
      prompt: await readFile(path.join(dir, "PROMPT.md"), "utf-8"),
      rubric: await readFile(path.join(dir, "RUBRIC.md"), "utf-8"),
    });
  }

  type Task = {
    fixture: string;
    mode: Mode;
    modelId: string;
    runIndex: number;
  };
  const tasks: Task[] = [];
  for (const fixture of fixtures) {
    for (const mode of modes) {
      for (const modelId of args.models) {
        for (let i = 1; i <= args.runs; i++) {
          tasks.push({ fixture, mode, modelId, runIndex: i });
        }
      }
    }
  }

  let completed = 0;
  await runPool(tasks, args.concurrency, async (task) => {
    const texts = fixtureText.get(task.fixture);
    if (!texts) {
      return;
    }
    await runOne({
      fixture: task.fixture,
      mode: task.mode,
      modelId: task.modelId,
      judge: args.judge,
      runIndex: task.runIndex,
      totalRuns: args.runs,
      runDir,
      promptText: texts.prompt,
      rubricText: texts.rubric,
    });
    completed++;
    if (completed % 20 === 0 || completed === tasks.length) {
      process.stdout.write(`  …${completed}/${tasks.length} runs done\n`);
    }
  });

  const summary = await aggregateRun(runDir);
  process.stdout.write(
    `\n══ Done ══\n${summary.totalRuns} runs · report: ${path.join(runDir, "report.md")}\n`
  );
}

main().catch((err) => {
  process.stderr.write(
    `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(1);
});
