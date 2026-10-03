#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateRun } from "./lib/aggregate";
import { loadLlmsExpected, selectionMatchesVariant } from "./lib/llms-metrics";
import { summarizePackageReads } from "./lib/package-metrics";
import { runPool } from "./lib/pool";
import type { RunRecord } from "./lib/record";
import type { Transcript } from "./lib/transcript";

const evalsRoot = fileURLToPath(new URL(".", import.meta.url));

/**
 * Recompute the supporting *mechanism* metrics (bundle usage for the package
 * benchmark; context match / wrong-group reads for the llms benchmark) for an
 * already-graded run, straight from its archived transcripts — no agents and
 * no judge re-run.
 *
 * Use this after fixing how a mechanism metric is derived (e.g. once failed
 * reads stopped counting as bundle usage) so the committed `record.json`s and
 * `summary.json`/`report.md` reflect the corrected metric without paying to
 * regenerate the whole matrix. The judge verdict (`passed`, `score`,
 * `judgeModel`, …) is preserved untouched.
 */

function fixtureRoot(benchmark: string, fixture: string): string {
  const sub = benchmark === "llms" ? "llms" : "evals";
  return path.join(evalsRoot, sub, fixture);
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

type Change = { rel: string; before: string; after: string };

async function remetricOne(opts: {
  recordDir: string;
  runsDir: string;
  extractDir: string;
  changes: Change[];
}): Promise<{ rewritten: boolean; missingTranscript: boolean }> {
  const { recordDir, runsDir, extractDir, changes } = opts;
  const record = JSON.parse(
    await readFile(path.join(recordDir, "record.json"), "utf-8")
  ) as RunRecord;
  const relDir = path.relative(runsDir, recordDir);

  let transcript: Transcript;
  try {
    transcript = JSON.parse(
      await readFile(
        path.join(extractDir, "runs", relDir, "transcript.json"),
        "utf-8"
      )
    ) as Transcript;
  } catch {
    return { rewritten: false, missingTranscript: true };
  }

  const next: RunRecord = { ...record };
  if (record.benchmark === "package") {
    const reads = summarizePackageReads(transcript.toolCalls);
    next.discoveredAgentsMd = reads.discoveredAgentsMd;
    next.readBundledDocs = reads.readBundledDocs;
    next.usedBundle = reads.usedBundle;
  } else {
    const expected = loadLlmsExpected(
      fixtureRoot(record.benchmark, record.fixture)
    );
    const selection = selectionMatchesVariant(transcript, expected);
    next.contextMatched = selection.passed;
    next.wrongGroupReads = selection.wrongGroupReads.length;
  }

  const before = JSON.stringify(record);
  const after = JSON.stringify(next);
  if (before === after) {
    return { rewritten: false, missingTranscript: false };
  }
  changes.push({ rel: relDir, before, after });
  await writeFile(
    path.join(recordDir, "record.json"),
    `${JSON.stringify(next, null, 2)}\n`
  );
  return { rewritten: true, missingTranscript: false };
}

async function main(): Promise<void> {
  const runDirArg = process.argv[2];
  if (!runDirArg) {
    process.stderr.write("usage: bun run remetric.ts <runDir>\n");
    process.exit(1);
  }
  const runDir = path.resolve(runDirArg);
  const tgz = path.join(runDir, "transcripts.tgz");
  if (!existsSync(tgz)) {
    throw new Error(`No transcripts.tgz in ${runDir} — nothing to recompute.`);
  }

  const extractDir = await mkdtemp(path.join(tmpdir(), "remetric-"));
  const untar = spawnSync("tar", ["xzf", tgz, "-C", extractDir]);
  if (untar.status !== 0) {
    throw new Error(`tar extract failed: ${untar.stderr}`);
  }

  const runsDir = path.join(runDir, "runs");
  const recordDirs = await listRecordDirs(runsDir);
  process.stdout.write(
    `Recomputing mechanism metrics for ${recordDirs.length} runs in ${path.basename(runDir)}\n`
  );

  const changes: Change[] = [];
  let missing = 0;
  await runPool(recordDirs, 16, async (recordDir) => {
    const { missingTranscript } = await remetricOne({
      recordDir,
      runsDir,
      extractDir,
      changes,
    });
    if (missingTranscript) {
      missing++;
    }
  });

  await rm(extractDir, { recursive: true, force: true });

  process.stdout.write(
    `Rewrote ${changes.length} record.json (of ${recordDirs.length}); ${missing} had no archived transcript.\n`
  );
  if (changes.length > 0) {
    process.stdout.write("Re-aggregating…\n");
    const summary = await aggregateRun(runDir);
    process.stdout.write(
      `Wrote summary.json + report.md for ${summary.totalRuns} runs.\n`
    );
  }
}

main().catch((err) => {
  process.stderr.write(
    `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(1);
});
