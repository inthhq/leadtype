#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateRun, type RunSummary } from "./lib/aggregate";
import {
  DEFAULT_JUDGE_MODEL,
  type JudgeArtifact,
  judgeAnswer,
} from "./lib/judge";
import { runPool } from "./lib/pool";
import type { RunRecord } from "./lib/record";
import { formatPct } from "./lib/stats";
import type { Transcript } from "./lib/transcript";

const evalsRoot = fileURLToPath(new URL(".", import.meta.url));
const MAX_ARTIFACTS = 12;

type Args = {
  runDir: string;
  judge: string;
  concurrency: number;
  inPlace: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    runDir: "",
    judge: DEFAULT_JUDGE_MODEL,
    concurrency: 8,
    inPlace: false,
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i++];
    if (a === "--judge") {
      args.judge = argv[i++] ?? args.judge;
    } else if (a === "--concurrency") {
      args.concurrency = Number(argv[i++]);
    } else if (a === "--in-place") {
      // Re-grade the run's own records in place (back-fill the committed run),
      // rather than writing a parallel results-judge-<model> folder.
      args.inPlace = true;
    } else if (a && !a.startsWith("--")) {
      args.runDir = a;
    }
  }
  if (!args.runDir) {
    throw new Error(
      "usage: bun run rejudge.ts <runDir> [--judge <id>] [--concurrency <n>] [--in-place]"
    );
  }
  return args;
}

function fixtureRoot(benchmark: string, fixture: string): string {
  const sub = benchmark === "llms" ? "llms" : "evals";
  return path.join(evalsRoot, sub, fixture);
}

async function walkFiles(dir: string, base = dir): Promise<JudgeArtifact[]> {
  const out: JudgeArtifact[] = [];
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full, base)));
    } else {
      try {
        out.push({
          path: path.relative(base, full),
          content: await readFile(full, "utf-8"),
        });
      } catch {
        // skip unreadable
      }
    }
    if (out.length >= MAX_ARTIFACTS) {
      break;
    }
  }
  return out;
}

async function listRecordDirs(runsDir: string): Promise<string[]> {
  const dirs: string[] = [];
  const stack = [runsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === "record.json") {
        dirs.push(dir);
      }
    }
  }
  return dirs;
}

async function rejudgeOne(opts: {
  recordDir: string;
  runDir: string;
  extractDir: string;
  newRunDir: string;
  judge: string;
  promptCache: Map<string, { prompt: string; rubric: string }>;
}): Promise<void> {
  const { recordDir, runDir, extractDir, newRunDir, judge, promptCache } = opts;
  const record = JSON.parse(
    await readFile(path.join(recordDir, "record.json"), "utf-8")
  ) as RunRecord;
  const relDir = path.relative(runDir, recordDir); // runs/<fixture>/<arm>/<model>/run-i
  const traceDir = path.join(extractDir, relDir);

  let transcript: Transcript | undefined;
  try {
    transcript = JSON.parse(
      await readFile(path.join(traceDir, "transcript.json"), "utf-8")
    ) as Transcript;
  } catch {
    transcript = undefined;
  }

  const fixtureDir = fixtureRoot(record.benchmark, record.fixture);
  let texts = promptCache.get(fixtureDir);
  if (!texts) {
    texts = {
      prompt: await readFile(path.join(fixtureDir, "PROMPT.md"), "utf-8"),
      rubric: await readFile(path.join(fixtureDir, "RUBRIC.md"), "utf-8"),
    };
    promptCache.set(fixtureDir, texts);
  }

  let answer = transcript?.finalText ?? "";
  let artifacts: JudgeArtifact[] = [];
  if (record.benchmark === "llms") {
    try {
      answer =
        (await readFile(path.join(traceDir, "ANSWER.md"), "utf-8")) || answer;
    } catch {
      // keep finalText
    }
  } else {
    artifacts = await walkFiles(path.join(traceDir, "files"));
  }

  const verdict = await judgeAnswer({
    task: texts.prompt,
    rubric: texts.rubric,
    answer,
    artifacts,
    judgeModel: judge,
  });

  const newRecord: RunRecord = {
    ...record,
    passed: verdict.correct,
    score: verdict.score,
    judgeModel: verdict.judgeModel,
    judgeReasoning: verdict.reasoning,
    judgeError: verdict.error,
    failureMode: verdict.failureMode,
  };

  const destDir = path.join(newRunDir, relDir);
  await mkdir(destDir, { recursive: true });
  await writeFile(
    path.join(destDir, "record.json"),
    `${JSON.stringify(newRecord, null, 2)}\n`
  );
  await writeFile(
    path.join(destDir, "judge.json"),
    `${JSON.stringify(verdict, null, 2)}\n`
  );
}

function compareSummaries(old: RunSummary, fresh: RunSummary): void {
  process.stdout.write(
    `\n══ Judge comparison: ${old.judgeModels.join(",")} → ${fresh.judgeModels.join(",")} ══\n`
  );
  const arms =
    old.benchmark === "package" ? ["treatment", "control"] : ["(all)"];
  for (const arm of fresh.arms.length ? fresh.arms : arms) {
    process.stdout.write(`\n${arm}:\n`);
    for (const model of fresh.models) {
      const sel = (s: RunSummary) =>
        s.cells.filter((c) => c.model === model && c.arm === arm);
      const rate = (s: RunSummary) => {
        const cs = sel(s);
        const n = cs.reduce((a, c) => a + c.n, 0);
        const p = cs.reduce((a, c) => a + c.passes, 0);
        const score =
          cs.reduce((a, c) => a + c.meanScore * c.n, 0) / Math.max(1, n);
        return { n, p, score };
      };
      const o = rate(old);
      const f = rate(fresh);
      if (o.n === 0 && f.n === 0) {
        continue;
      }
      process.stdout.write(
        `  ${model.padEnd(18)} old ${formatPct(o.p / o.n)} (score ${o.score.toFixed(0)}) → new ${formatPct(f.p / f.n)} (score ${f.score.toFixed(0)})\n`
      );
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(args.runDir);
  const tgz = path.join(runDir, "transcripts.tgz");
  if (!existsSync(tgz)) {
    throw new Error(`No transcripts.tgz in ${runDir} — nothing to re-grade.`);
  }

  const extractDir = await mkdtemp(path.join(tmpdir(), "rejudge-"));
  const untar = spawnSync("tar", ["xzf", tgz, "-C", extractDir]);
  if (untar.status !== 0) {
    throw new Error(`tar extract failed: ${untar.stderr}`);
  }

  const recordDirs = await listRecordDirs(path.join(runDir, "runs"));
  const judgeSlug = args.judge.replace(/[^\w.-]+/g, "_");
  const newRunDir = args.inPlace ? runDir : `${runDir}-judge-${judgeSlug}`;
  await mkdir(newRunDir, { recursive: true });

  // Snapshot the existing summary before we overwrite anything (matters for the
  // in-place back-fill, where aggregateRun rewrites runDir/summary.json).
  const old = JSON.parse(
    await readFile(path.join(runDir, "summary.json"), "utf-8")
  ) as RunSummary;

  process.stdout.write(
    `Re-judging ${recordDirs.length} runs from ${path.basename(runDir)} with ${args.judge}${args.inPlace ? " (in place)" : ""} (concurrency ${args.concurrency})\n`
  );

  const promptCache = new Map<string, { prompt: string; rubric: string }>();
  let done = 0;
  await runPool(recordDirs, args.concurrency, async (recordDir) => {
    await rejudgeOne({
      recordDir,
      runDir,
      extractDir,
      newRunDir,
      judge: args.judge,
      promptCache,
    });
    done++;
    if (done % 50 === 0 || done === recordDirs.length) {
      process.stdout.write(`  …${done}/${recordDirs.length}\n`);
    }
  });

  const fresh = await aggregateRun(newRunDir);
  compareSummaries(old, fresh);
  await rm(extractDir, { recursive: true, force: true });
  process.stdout.write(`\nWrote ${newRunDir}/summary.json + report.md\n`);
}

main().catch((err) => {
  process.stderr.write(
    `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(1);
});
