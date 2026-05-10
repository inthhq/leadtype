#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateway, generateText, stepCountIs } from "ai";
import { loadLlmsExpected, selectionMatchesVariant } from "./lib/llms-metrics";
import { createLlmsSandbox } from "./lib/llms-sandbox";
import {
  LLMS_VARIANTS,
  type LlmsVariant,
  parseLlmsVariant,
} from "./lib/llms-variants";
import { scopedTools } from "./lib/tools";
import {
  type Provider,
  type ToolCall,
  type Transcript,
  transcriptPathFor,
  writeTranscript,
} from "./lib/transcript";

const evalsRoot = fileURLToPath(new URL(".", import.meta.url));
const fixturesRoot = path.join(evalsRoot, "llms");

const SYSTEM_PROMPT = `You are an expert coding agent evaluating a hosted docs site.

The docs site's web root is represented by files in the current project root. Treat a URL like /llms.txt as the file llms.txt, and a URL like /docs/reference/cli.md as docs/reference/cli.md.

Start at /llms.txt. Use only the docs files you read from this web-root representation. Write your final answer to ANSWER.md.`;

const STEP_LIMIT = 40;

type CliArgs = {
  fixture?: string;
  variant?: LlmsVariant;
  model: string;
  runs: number;
};

type RunResult = {
  fixture: string;
  variant: LlmsVariant;
  passed: boolean;
  contextMatched: boolean;
  wrongGroupReads: number;
  durationMs: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  evalOutput: string;
};

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer, got ${value}`);
  }
  return parsed;
}

function parseRequiredFlagValue(
  value: string | undefined,
  flag: string
): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { model: "claude-haiku-4-5", runs: 1 };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    i++;
    if (a === "--fixture") {
      args.fixture = parseRequiredFlagValue(argv[i++], "--fixture");
    } else if (a === "--variant") {
      args.variant = parseLlmsVariant(argv[i++]);
    } else if (a === "--model") {
      args.model = parseRequiredFlagValue(argv[i++], "--model");
    } else if (a === "--runs") {
      args.runs = parsePositiveInt(argv[i++], "--runs");
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
  --fixture <name>    Run only one fixture (default: all)
  --variant <name>   Run one variant: ${LLMS_VARIANTS.join("|")} (default: all)
  --model <id>       Model id, e.g. claude-haiku-4-5, claude-opus-4-7,
                     gpt-5.5 (default: claude-haiku-4-5)
  --runs <n>         Repetitions per (fixture x variant) combo (default: 1)
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

function namespaceModelId(modelId: string): string {
  if (modelId.includes("/")) {
    return modelId;
  }
  if (modelId.startsWith("gpt-")) {
    return `openai/${modelId}`;
  }
  return `anthropic/${modelId}`;
}

function getModel(modelId: string): {
  provider: Provider;
  // biome-ignore lint/suspicious/noExplicitAny: the AI SDK model handle is an opaque shape
  model: any;
} {
  const namespaced = namespaceModelId(modelId);
  const provider: Provider = namespaced.startsWith("openai/")
    ? "openai"
    : "anthropic";
  return { provider, model: gateway(namespaced) };
}

async function runOne(options: {
  fixture: string;
  variant: LlmsVariant;
  modelId: string;
  runIndex: number;
  totalRuns: number;
}): Promise<RunResult> {
  const { fixture, variant, modelId, runIndex, totalRuns } = options;
  const fixtureDir = path.join(fixturesRoot, fixture);
  const promptText = await readFile(
    path.join(fixtureDir, "PROMPT.md"),
    "utf-8"
  );

  process.stdout.write(
    `* ${fixture} / ${variant} [${runIndex}/${totalRuns}] (${modelId})\n`
  );

  const sandbox = await createLlmsSandbox({ fixtureDir, variant });
  const start = Date.now();
  const transcriptCalls: ToolCall[] = [];
  const filesModified = new Set<string>();
  const tools = scopedTools({
    tempDir: sandbox.tempDir,
    transcript: transcriptCalls,
    filesModified,
  });

  const { provider, model } = getModel(modelId);
  const errors: string[] = [];
  let finalText = "";
  let steps = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: promptText,
      tools,
      stopWhen: stepCountIs(STEP_LIMIT),
    });
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
  await writeTranscript(sandbox.tempDir, transcript);

  try {
    const expected = loadLlmsExpected(fixtureDir);
    const selection = selectionMatchesVariant(transcript, expected);
    const evalResult = await runVitest(fixture, sandbox.tempDir);
    const passed = evalResult.passed;

    process.stdout.write(
      `  ${passed ? "ok" : "fail"} ${(durationMs / 1000).toFixed(1)}s · ${transcriptCalls.length} calls · context ${selection.passed ? "ok" : "miss"} · ${inputTokens}in/${outputTokens}out\n`
    );
    if (errors.length > 0) {
      for (const error of errors) {
        process.stdout.write(`    ! ${error}\n`);
      }
    }
    if (!passed) {
      const tailLines = evalResult.output.split("\n").slice(-25).join("\n");
      process.stdout.write(`${tailLines}\n`);
    }

    await archiveTranscript({
      fixture,
      variant,
      runIndex,
      tempDir: sandbox.tempDir,
      transcript,
    });

    return {
      fixture,
      variant,
      passed,
      contextMatched: selection.passed,
      wrongGroupReads: selection.wrongGroupReads.length,
      durationMs,
      toolCalls: transcriptCalls.length,
      inputTokens,
      outputTokens,
      evalOutput: evalResult.output,
    };
  } finally {
    await sandbox.cleanup();
  }
}

async function archiveTranscript(opts: {
  fixture: string;
  variant: LlmsVariant;
  runIndex: number;
  tempDir: string;
  transcript: Transcript;
}): Promise<void> {
  const { fixture, variant, runIndex, tempDir, transcript } = opts;
  const ts = new Date().toISOString().replace(/[.:]/g, "-");
  const dir = path.join(
    evalsRoot,
    "results",
    "llms",
    fixture,
    variant,
    `${ts}-run${runIndex}`
  );
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "transcript.json"),
    `${JSON.stringify(transcript, null, 2)}\n`
  );
  for (const rel of transcript.filesModified) {
    try {
      const content = await readFile(path.join(tempDir, rel), "utf-8");
      const dest = path.join(dir, "files", rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, content);
    } catch {
      // Best effort archive for files that still exist.
    }
  }
}

async function runVitest(
  fixture: string,
  tempDir: string
): Promise<{ passed: boolean; output: string }> {
  const evalFile = path.join(fixturesRoot, fixture, "EVAL.ts");
  return await new Promise((resolveSpawn) => {
    let settled = false;
    const settle = (result: { passed: boolean; output: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveSpawn(result);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("bun", ["x", "vitest", "run", evalFile], {
        cwd: evalsRoot,
        env: {
          ...process.env,
          TRANSCRIPT_PATH: transcriptPathFor(tempDir),
        },
      });
    } catch (err) {
      settle({
        passed: false,
        output: `failed to spawn vitest: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    let output = "";
    proc.stdout.on("data", (b) => {
      output += b.toString();
    });
    proc.stderr.on("data", (b) => {
      output += b.toString();
    });
    proc.on("error", (err) => {
      settle({
        passed: false,
        output: `${output}\nspawn error: ${err.message}`,
      });
    });
    proc.on("close", (code) => {
      settle({ passed: code === 0, output });
    });
  });
}

function summarize(results: RunResult[]): void {
  process.stdout.write("\n== llms-full Variant Summary ==\n");
  process.stdout.write(
    "fixture                         variant             pass       context    wrong grp   avg calls   avg tokens\n"
  );
  const keys = [
    ...new Set(results.map((result) => `${result.fixture}\0${result.variant}`)),
  ].sort();

  for (const key of keys) {
    const [fixture, variant] = key.split("\0") as [string, LlmsVariant];
    const rows = results.filter(
      (result) => result.fixture === fixture && result.variant === variant
    );
    const passed = rows.filter((row) => row.passed).length;
    const contextMatched = rows.filter((row) => row.contextMatched).length;
    const wrongGroups = rows.reduce(
      (total, row) => total + row.wrongGroupReads,
      0
    );
    const avgCalls = average(rows.map((row) => row.toolCalls));
    const avgTokens = average(
      rows.map((row) => row.inputTokens + row.outputTokens)
    );

    process.stdout.write(
      `${fixture.padEnd(32)}${variant.padEnd(20)}${`${passed}/${rows.length}`.padEnd(11)}${`${contextMatched}/${rows.length}`.padEnd(11)}${String(wrongGroups).padEnd(12)}${avgCalls.toFixed(1).padEnd(12)}${avgTokens.toFixed(0)}\n`
    );
  }

  const totalRuns = results.length;
  const passed = results.filter((result) => result.passed).length;
  process.stdout.write(
    `\nOverall: ${passed}/${totalRuns} passed (${((passed / totalRuns) * 100).toFixed(0)}%)\n`
  );
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
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
  const variants = args.variant ? [args.variant] : [...LLMS_VARIANTS];

  const results: RunResult[] = [];
  for (const fixture of fixtures) {
    for (const variant of variants) {
      for (let i = 1; i <= args.runs; i++) {
        const result = await runOne({
          fixture,
          variant,
          modelId: args.model,
          runIndex: i,
          totalRuns: args.runs,
        });
        results.push(result);
      }
    }
  }
  summarize(results);
  process.exit(results.every((result) => result.passed) ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(
    `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(1);
});
