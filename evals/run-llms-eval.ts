#!/usr/bin/env bun
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateway, generateText, stepCountIs } from "ai";
import { aggregateRun } from "./lib/aggregate";
import { DEFAULT_JUDGE_MODEL, judgeAnswer } from "./lib/judge";
import { loadLlmsExpected, selectionMatchesVariant } from "./lib/llms-metrics";
import { createLlmsSandbox } from "./lib/llms-sandbox";
import {
  LLMS_VARIANTS,
  type LlmsVariant,
  parseLlmsVariant,
} from "./lib/llms-variants";
import { namespaceModelId, parseModelList, providerFor } from "./lib/models";
import { runPool } from "./lib/pool";
import type { RunRecord } from "./lib/record";
import { withRetry } from "./lib/retry";
import { scopedTools } from "./lib/tools";
import type { ToolCall, Transcript } from "./lib/transcript";

const evalsRoot = fileURLToPath(new URL(".", import.meta.url));
const fixturesRoot = path.join(evalsRoot, "llms");

const SYSTEM_PROMPT = `You are an expert coding agent evaluating a hosted docs site.

The docs site's web root is represented by files in the current project root. Treat a URL like /llms.txt as the file llms.txt, and a URL like /docs/reference/cli.md as docs/reference/cli.md.

Start at /llms.txt. Use only the docs files you read from this web-root representation. Write your final answer to ANSWER.md.`;

const STEP_LIMIT = 40;
const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MODEL_TIMEOUT_MS = 120_000;
const MODEL_TIMEOUT_MS =
  process.env.LLMS_EVAL_MODEL_TIMEOUT_MS === undefined
    ? DEFAULT_MODEL_TIMEOUT_MS
    : parsePositiveInt(
        process.env.LLMS_EVAL_MODEL_TIMEOUT_MS,
        "LLMS_EVAL_MODEL_TIMEOUT_MS"
      );

type CliArgs = {
  fixture?: string;
  variant?: LlmsVariant;
  models: string[];
  judge: string;
  runs: number;
  label?: string;
  concurrency: number;
};

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
    } else if (a === "--variant") {
      args.variant = parseLlmsVariant(
        parseRequiredFlagValue(argv[i++], "--variant")
      );
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
  process.stdout.write(`Usage: bun run run-llms-eval.ts [options]

Options:
  --fixture <name>   Run only one fixture (default: all)
  --variant <name>   Run one variant: ${LLMS_VARIANTS.join("|")} (default: all)
  --models <a,b,c>   Comma-separated candidate model ids (default: ${DEFAULT_MODEL})
  --model <id>       Alias for a single --models entry
  --judge <id>       Judge model id (default: ${DEFAULT_JUDGE_MODEL})
  --runs <n>         Repetitions per (fixture × variant × model) (default: 1)
  --concurrency <n>  Number of runs in flight at once (default: 1)
  --label <name>     Results folder name under results/llms/ (default: timestamp)
  -h, --help         Show this help
`);
}

function discoverFixtures(): string[] {
  if (!existsSync(fixturesRoot)) {
    return [];
  }
  return readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .filter((name) => existsSync(path.join(fixturesRoot, name, "PROMPT.md")))
    .sort();
}

async function runOne(options: {
  fixture: string;
  variant: LlmsVariant;
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
    variant,
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
    `▶ ${fixture} / ${variant} / ${modelId} [${runIndex}/${totalRuns}]\n`
  );

  const sandbox = await createLlmsSandbox({ fixtureDir, variant });
  const start = Date.now();
  const transcriptCalls: ToolCall[] = [];
  const filesModified = new Set<string>();
  // Docs-reading task: drop the npm tool so the model doesn't waste steps.
  const { npm: _omit, ...tools } = scopedTools({
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
  const transcript: Transcript = {
    fixture,
    benchmark: "llms",
    mode: "treatment",
    variant,
    agent: { provider, model: modelId },
    toolCalls: transcriptCalls,
    filesModified: [...filesModified].sort(),
    finalText,
    durationMs,
    steps,
    errors,
    tokens: { input: inputTokens, output: outputTokens },
  };

  const expected = loadLlmsExpected(fixtureDir);
  const selection = selectionMatchesVariant(transcript, expected);

  let answerContent = "";
  try {
    answerContent = await readFile(
      path.join(sandbox.tempDir, "ANSWER.md"),
      "utf-8"
    );
  } catch {
    answerContent = finalText;
  }
  const verdict = await judgeAnswer({
    task: promptText,
    rubric: rubricText,
    answer: answerContent || finalText,
    judgeModel: judge,
  });

  const record: RunRecord = {
    benchmark: "llms",
    fixture,
    model: modelId,
    runIndex,
    variant,
    passed: verdict.correct,
    score: verdict.score,
    judgeModel: verdict.judgeModel,
    judgeReasoning: verdict.reasoning,
    judgeError: verdict.error,
    contextMatched: selection.passed,
    wrongGroupReads: selection.wrongGroupReads.length,
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
    variant,
    modelId,
    runIndex,
    tempDir: sandbox.tempDir,
    transcript,
    verdict,
    record,
    answerContent,
  });
  await sandbox.cleanup();

  process.stdout.write(
    `  ${verdict.correct ? "✓" : "✗"} score ${verdict.score} · context ${selection.passed ? "ok" : "miss"} · ${(durationMs / 1000).toFixed(1)}s · ${transcriptCalls.length} calls${verdict.error ? " · JUDGE ERROR" : ""}\n`
  );
  for (const e of errors) {
    process.stdout.write(`    ! ${e}\n`);
  }
  return record;
}

async function archiveRun(opts: {
  runDir: string;
  fixture: string;
  variant: LlmsVariant;
  modelId: string;
  runIndex: number;
  tempDir: string;
  transcript: Transcript;
  verdict: Awaited<ReturnType<typeof judgeAnswer>>;
  record: RunRecord;
  answerContent: string;
}): Promise<void> {
  const dir = path.join(
    opts.runDir,
    "runs",
    opts.fixture,
    opts.variant,
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
  if (opts.answerContent) {
    await writeFile(path.join(dir, "ANSWER.md"), opts.answerContent);
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
    ? [args.fixture].filter((fixture) => allFixtures.includes(fixture))
    : allFixtures;
  if (fixtures.length === 0) {
    process.stderr.write(`Fixture not found: ${args.fixture}\n`);
    process.exit(1);
  }
  const variants = args.variant
    ? [args.variant]
    : LLMS_VARIANTS.map(parseLlmsVariant);

  const runId = args.label ?? new Date().toISOString().replace(/[.:]/g, "-");
  const runDir = path.join(evalsRoot, "results", "llms", runId);
  await mkdir(runDir, { recursive: true });

  const total =
    fixtures.length * variants.length * args.models.length * args.runs;
  process.stdout.write(
    `Hosted-docs benchmark: ${fixtures.length} fixtures × ${variants.length} variants × ${args.models.length} models × ${args.runs} runs = ${total} agent runs\nJudge: ${args.judge} · concurrency: ${args.concurrency}\nResults: ${runDir}\n\n`
  );

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
    variant: LlmsVariant;
    modelId: string;
    runIndex: number;
  };
  const tasks: Task[] = [];
  for (const fixture of fixtures) {
    for (const variant of variants) {
      for (const modelId of args.models) {
        for (let i = 1; i <= args.runs; i++) {
          tasks.push({ fixture, variant, modelId, runIndex: i });
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
      variant: task.variant,
      modelId: task.modelId,
      judge: args.judge,
      runIndex: task.runIndex,
      totalRuns: args.runs,
      runDir,
      promptText: texts.prompt,
      rubricText: texts.rubric,
    });
    completed++;
    if (completed % 25 === 0 || completed === tasks.length) {
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
