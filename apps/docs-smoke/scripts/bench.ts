#!/usr/bin/env bun
/**
 * Benchmark the @inth/docs pipeline against the cloned c15t docs.
 * Runs each stage N times, reports median/min/max as a markdown table.
 * Writes to $GITHUB_STEP_SUMMARY when present so CI surfaces the numbers
 * on the PR checks page. No threshold gating — GH Actions shared runners
 * are too noisy (20–30% variance) for fail-on-regression to be reliable.
 */

import { existsSync } from "node:fs";
import { appendFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { convertAllMdx } from "../../../packages/docs/src/convert/index.ts";
import {
  generateLLMFullContextFiles,
  generateLlmsTxt,
} from "../../../packages/docs/src/llm/index.ts";
import {
  defaultRemarkPlugins,
  remarkInclude,
} from "../../../packages/docs/src/remark/index.ts";

const DEFAULT_RUNS = 3;
const parsedRuns = Number.parseInt(
  process.env.BENCH_RUNS ?? String(DEFAULT_RUNS),
  10
);
if (!Number.isInteger(parsedRuns) || parsedRuns < 1) {
  process.stderr.write(
    `BENCH_RUNS must be a positive integer, got ${JSON.stringify(process.env.BENCH_RUNS)}\n`
  );
  process.exit(2);
}
const RUNS = parsedRuns;
const FIXTURE_DIR = join(process.cwd(), "content-fixtures", "c15t");
const SRC_DIR = join(FIXTURE_DIR, "docs");
const OUT_DIR = join(process.cwd(), "public-bench");
// LLM gen expects .md files under `{outDir}/docs/`, so convert writes into
// `OUT_DIR/docs/` to match the convention.
const CONVERT_OUT_DIR = join(OUT_DIR, "docs");

if (!existsSync(SRC_DIR)) {
  process.stderr.write(
    "content-fixtures/c15t not found — run `bun run setup:real` first.\n"
  );
  process.exit(1);
}

interface Stats {
  label: string;
  runs: number[];
}

function median(values: number[]): number {
  // Empty input → 0. Documented so callers don't rely on the nullish
  // coalescing below as implicit fallback handling.
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
  }
  return sorted[mid] ?? 0;
}

async function timed(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return Math.round(performance.now() - start);
}

async function bench(): Promise<Stats[]> {
  const convertRuns: number[] = [];
  const llmRuns: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    await rm(OUT_DIR, { recursive: true, force: true });

    const convertMs = await timed(() =>
      convertAllMdx({
        srcDir: SRC_DIR,
        outDir: CONVERT_OUT_DIR,
        remarkPlugins: [remarkInclude, ...defaultRemarkPlugins],
        enrichFrontmatterFromGit: true,
      })
    );

    const llmMs = await timed(async () => {
      await generateLlmsTxt({
        srcDir: SRC_DIR,
        outDir: OUT_DIR,
        baseUrl: "https://docs.example.com",
        product: {
          name: "Bench SDK",
          summary: "Benchmark fixture.",
          bestStartingPoints: [],
        },
        docsSections: [
          {
            title: "Frameworks",
            links: [{ urlPath: "/docs/frameworks" }],
          },
          {
            title: "Integrations",
            links: [{ urlPath: "/docs/integrations/overview" }],
          },
        ],
      });
      await generateLLMFullContextFiles({
        outDir: OUT_DIR,
        baseUrl: "https://docs.example.com",
        product: { name: "Bench SDK" },
        topics: [
          {
            slug: "frameworks",
            title: "Frameworks",
            description: "Framework-specific guides.",
            includePrefixes: ["frameworks/"],
          },
          {
            slug: "integrations",
            title: "Integrations",
            description: "Integration guides.",
            includePrefixes: ["integrations/"],
          },
          {
            slug: "self-host",
            title: "Self-host",
            description: "Self-hosting guides.",
            includePrefixes: ["self-host/"],
          },
        ],
      });
    });

    convertRuns.push(convertMs);
    llmRuns.push(llmMs);

    process.stdout.write(
      `run ${i + 1}/${RUNS}: convert=${convertMs}ms  llm=${llmMs}ms\n`
    );
  }

  await rm(OUT_DIR, { recursive: true, force: true });

  return [
    { label: "convert", runs: convertRuns },
    { label: "llm", runs: llmRuns },
    {
      label: "convert+llm",
      runs: convertRuns.map((c, i) => c + (llmRuns[i] ?? 0)),
    },
  ];
}

function renderTable(stats: Stats[]): string {
  const lines = [
    "| stage | median | min | max | runs |",
    "| --- | ---: | ---: | ---: | :--- |",
  ];
  for (const stat of stats) {
    const m = median(stat.runs);
    const min = Math.min(...stat.runs);
    const max = Math.max(...stat.runs);
    const series = stat.runs.map((x) => `${x}ms`).join(", ");
    lines.push(
      `| \`${stat.label}\` | ${m}ms | ${min}ms | ${max}ms | ${series} |`
    );
  }
  return lines.join("\n");
}

async function countMdxFiles(dir: string): Promise<number> {
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith(".mdx")) {
        count += 1;
      }
    }
  }
  return count;
}

const stats = await bench();
const table = renderTable(stats);
const mdxCount = await countMdxFiles(SRC_DIR);
const header = `### @inth/docs benchmark\n\nFixture: c15t docs (${mdxCount} .mdx files), git enrichment on, ${RUNS} runs each.\n\n`;
const report = header + table;

process.stdout.write(`\n${report}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}
