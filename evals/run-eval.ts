#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateway, generateText, stepCountIs } from "ai";
import { createSandbox } from "./lib/sandbox";
import { scopedTools } from "./lib/tools";
import {
  type Mode,
  type Provider,
  type ToolCall,
  type Transcript,
  transcriptPathFor,
  writeTranscript,
} from "./lib/transcript";

const evalsRoot = fileURLToPath(new URL(".", import.meta.url));
const fixturesRoot = path.join(evalsRoot, "evals");

const SYSTEM_PROMPT = `You are an expert coding agent working inside a project that depends on the npm package \`leadtype\`. The project root is your working directory; every tool path is relative to it. You have a small set of tools — read, write, list, glob, grep, and a narrow npm tool that supports only \`pack\` and \`install\`. There is no shell.

Solve the user's task as you normally would: explore relevant files first, then make the changes. When the task asks you to verify a result (e.g. with \`npm pack --dry-run\`), use the npm tool. When you are done, write a short final summary describing what you did.`;

const STEP_LIMIT = 50;

type CliArgs = {
  fixture?: string;
  mode?: Mode;
  model: string;
  runs: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { model: "claude-haiku-4-5", runs: 1 };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    i++;
    if (a === "--fixture") {
      args.fixture = argv[i++];
    } else if (a === "--mode") {
      const v = argv[i++];
      if (v !== "treatment" && v !== "control") {
        throw new Error(`--mode must be treatment|control, got ${v}`);
      }
      args.mode = v;
    } else if (a === "--model") {
      args.model = argv[i++] ?? args.model;
    } else if (a === "--runs") {
      args.runs = Number.parseInt(argv[i++] ?? "1", 10);
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
  --mode <m>         Run only one mode: treatment|control (default: both)
  --model <id>       Model id, e.g. claude-haiku-4-5, claude-opus-4-7,
                     gpt-5.5 (default: claude-haiku-4-5)
  --runs <n>         Repetitions per (fixture × mode) combo (default: 1)
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

type RunResult = {
  fixture: string;
  mode: Mode;
  passed: boolean;
  durationMs: number;
  toolCalls: number;
  discoveredAgentsMd: boolean;
  evalOutput: string;
};

async function runOne(options: {
  fixture: string;
  mode: Mode;
  modelId: string;
  runIndex: number;
  totalRuns: number;
}): Promise<RunResult> {
  const { fixture, mode, modelId, runIndex, totalRuns } = options;
  const fixtureDir = path.join(fixturesRoot, fixture);
  const promptText = await readFile(
    path.join(fixtureDir, "PROMPT.md"),
    "utf-8"
  );

  process.stdout.write(
    `▶ ${fixture} / ${mode} [${runIndex}/${totalRuns}] (${modelId})\n`
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
    mode,
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

  const evalResult = await runVitest(fixture, sandbox.tempDir);

  const discoveredAgentsMd = transcriptCalls.some((c) => {
    if (c.tool !== "read") {
      return false;
    }
    const p = (c.args.path as string | undefined) ?? "";
    return p.includes("node_modules/leadtype/AGENTS.md");
  });

  process.stdout.write(
    `  ${evalResult.passed ? "✓" : "✗"} ${(durationMs / 1000).toFixed(1)}s · ${transcriptCalls.length} tool calls · ${inputTokens}in/${outputTokens}out${
      discoveredAgentsMd ? " · read AGENTS.md" : ""
    }\n`
  );
  if (errors.length > 0) {
    for (const e of errors) {
      process.stdout.write(`    ! ${e}\n`);
    }
  }
  if (!evalResult.passed) {
    // Print just the last chunk of vitest's output — it contains the
    // assertion error in whatever format vitest is using today.
    const tailLines = evalResult.output.split("\n").slice(-25).join("\n");
    process.stdout.write(`${tailLines}\n`);
  }

  await archiveTranscript({
    fixture,
    mode,
    runIndex,
    tempDir: sandbox.tempDir,
    transcript,
  });
  await sandbox.cleanup();

  return {
    fixture,
    mode,
    passed: evalResult.passed,
    durationMs,
    toolCalls: transcriptCalls.length,
    discoveredAgentsMd,
    evalOutput: evalResult.output,
  };
}

async function archiveTranscript(opts: {
  fixture: string;
  mode: Mode;
  runIndex: number;
  tempDir: string;
  transcript: Transcript;
}): Promise<void> {
  const { fixture, mode, runIndex, tempDir, transcript } = opts;
  const ts = new Date().toISOString().replace(/[.:]/g, "-");
  const dir = path.join(
    evalsRoot,
    "results",
    fixture,
    mode,
    `${ts}-run${runIndex}`
  );
  const fs = await import("node:fs/promises");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "transcript.json"),
    `${JSON.stringify(transcript, null, 2)}\n`
  );
  // Also list the modified files' content snapshots — helpful when an
  // assertion that reads a file fails.
  for (const rel of transcript.filesModified) {
    try {
      const src = path.join(tempDir, rel);
      const content = await fs.readFile(src, "utf-8");
      const dest = path.join(dir, "files", rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content);
    } catch {
      // Best effort; skip silently if a file vanished.
    }
  }
}

async function runVitest(
  fixture: string,
  tempDir: string
): Promise<{ passed: boolean; output: string }> {
  const evalFile = path.join(fixturesRoot, fixture, "EVAL.ts");
  return await new Promise((resolveSpawn) => {
    const proc = spawn("bun", ["x", "vitest", "run", evalFile], {
      cwd: evalsRoot,
      env: {
        ...process.env,
        TRANSCRIPT_PATH: transcriptPathFor(tempDir),
      },
    });
    let output = "";
    proc.stdout.on("data", (b) => {
      output += b.toString();
    });
    proc.stderr.on("data", (b) => {
      output += b.toString();
    });
    proc.on("close", (code) => {
      resolveSpawn({ passed: code === 0, output });
    });
  });
}

function summarize(results: RunResult[]): void {
  process.stdout.write("\n══ Summary ══\n");
  const fixtures = [...new Set(results.map((r) => r.fixture))].sort();
  process.stdout.write(
    "fixture                          treatment   control   delta   discovered AGENTS.md (treatment)\n"
  );
  for (const fixture of fixtures) {
    const t = results.filter(
      (r) => r.fixture === fixture && r.mode === "treatment"
    );
    const c = results.filter(
      (r) => r.fixture === fixture && r.mode === "control"
    );
    const tPass = t.filter((r) => r.passed).length;
    const cPass = c.filter((r) => r.passed).length;
    const tDisc = t.filter((r) => r.discoveredAgentsMd).length;
    const treatmentLabel = t.length > 0 ? `${tPass}/${t.length}` : "—";
    const controlLabel = c.length > 0 ? `${cPass}/${c.length}` : "—";
    const delta =
      t.length > 0 && c.length > 0 ? tPass / t.length - cPass / c.length : 0;
    const deltaLabel = `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`;
    const discLabel = t.length > 0 ? `${tDisc}/${t.length}` : "—";
    process.stdout.write(
      `${fixture.padEnd(34)}${treatmentLabel.padEnd(12)}${controlLabel.padEnd(10)}${deltaLabel.padEnd(8)}${discLabel}\n`
    );
  }

  const totalRuns = results.length;
  const passed = results.filter((r) => r.passed).length;
  process.stdout.write(
    `\nOverall: ${passed}/${totalRuns} passed (${((passed / totalRuns) * 100).toFixed(0)}%)\n`
  );
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
  const modes: Mode[] = args.mode ? [args.mode] : ["treatment", "control"];

  const results: RunResult[] = [];
  for (const fixture of fixtures) {
    for (const mode of modes) {
      for (let i = 1; i <= args.runs; i++) {
        const result = await runOne({
          fixture,
          mode,
          modelId: args.model,
          runIndex: i,
          totalRuns: args.runs,
        });
        results.push(result);
      }
    }
  }
  summarize(results);
  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(
    `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(1);
});
