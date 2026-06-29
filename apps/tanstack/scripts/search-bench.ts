#!/usr/bin/env bun
/**
 * Benchmark leadtype search + AI-answer retrieval across corpus sizes.
 *
 * Corpora:
 *  - c15t: content-fixtures/c15t (run `bun run pipeline:setup-real` first),
 *    MDX converted via the real pipeline.
 *  - tanstack: TanStack Router + Start + Query docs. Point
 *    TANSTACK_FIXTURE_DIR at a directory containing `router/docs` and
 *    `query/docs` checkouts; skipped when unset.
 *  - tanstack-x2 / tanstack-x4: the tanstack corpus duplicated to project
 *    future growth. Duplication scales chunk/posting counts but not
 *    vocabulary, so term-count growth is understated.
 *
 * Per corpus: index build time, artifact sizes (raw/gzip/brotli), client
 * parse time, memory held by the parsed artifacts, search latency over a
 * mixed query set, and createAnswerContext (retrieval-only) latency.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { convertAllMdx } from "leadtype/convert";
import { defaultRemarkPlugins, remarkInclude } from "leadtype/remark";
import {
  createAnswerContext,
  type DocsSearchContentStore,
  type DocsSearchIndex,
  searchDocs,
} from "leadtype/search";
import { generateDocsSearchFiles } from "leadtype/search/node";

const WORK_DIR = join(process.cwd(), "search-bench-work");
const C15T_SRC = join(process.cwd(), "content-fixtures", "c15t", "docs");
const TANSTACK_FIXTURE_DIR = process.env.TANSTACK_FIXTURE_DIR;
const QUERY_ITERATIONS = 30;
const QUERY_WARMUPS = 3;
const ANSWER_ITERATIONS = 10;

const QUERIES = [
  "config",
  "install",
  "useQuery cache invalidation",
  "type safe route params",
  "cookie consent banner",
  "server function middleware",
  "optimistic updates rollback",
  "router loadr",
  "preload data before navigation",
  "infinite scroll pagination",
];

const ANSWER_QUERIES = [
  "how do I invalidate queries after a mutation",
  "how do I set up a cookie consent banner",
  "how does route preloading work",
];

interface CorpusSpec {
  name: string;
  prepare: (docsDir: string) => Promise<void>;
}

interface BenchRow {
  answerP50: number;
  buildMs: number;
  chunks: number;
  contentBrotli: number;
  contentBytes: number;
  contentGzip: number;
  docs: number;
  indexBrotli: number;
  indexBytes: number;
  indexGzip: number;
  memMb: number;
  name: string;
  parseMs: number;
  queryMax: number;
  queryP50: number;
  queryP95: number;
  slowestQuery: string;
  slowestQueryMs: number;
  terms: number;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length)
  );
  return sorted[index] ?? 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

function formatBytes(bytes: number): string {
  const MB = 1024 * 1024;
  const KB = 1024;
  if (bytes >= MB) {
    return `${(bytes / MB).toFixed(2)} MB`;
  }
  return `${(bytes / KB).toFixed(0)} KB`;
}

function formatMs(ms: number): string {
  if (ms >= 100) {
    return `${Math.round(ms)} ms`;
  }
  if (ms >= 1) {
    return `${ms.toFixed(1)} ms`;
  }
  return `${ms.toFixed(2)} ms`;
}

async function prepareC15t(docsDir: string): Promise<void> {
  await convertAllMdx({
    srcDir: C15T_SRC,
    outDir: docsDir,
    remarkPlugins: [remarkInclude, ...defaultRemarkPlugins],
  });
}

function makeTanstackPrepare(copies: number) {
  return async (docsDir: string): Promise<void> => {
    if (!TANSTACK_FIXTURE_DIR) {
      throw new Error("TANSTACK_FIXTURE_DIR is not set");
    }
    const sources = [
      ["router", join(TANSTACK_FIXTURE_DIR, "router", "docs")],
      ["query", join(TANSTACK_FIXTURE_DIR, "query", "docs")],
    ] as const;
    for (let copy = 0; copy < copies; copy++) {
      const suffix = copies === 1 ? "" : `-copy${copy}`;
      for (const [label, sourceDir] of sources) {
        await cp(sourceDir, join(docsDir, `${label}${suffix}`), {
          recursive: true,
        });
      }
    }
  };
}

const MEMORY_PROBE_SCRIPT = `
const { readFileSync } = require("node:fs");
const paths = JSON.parse(process.env.BENCH_PATHS ?? "[]");
const texts = paths.map((p) => readFileSync(p, "utf8"));
Bun.gc(true);
const before = process.memoryUsage.rss();
globalThis.keep = texts.map((t) => JSON.parse(t));
Bun.gc(true);
process.stdout.write(String(process.memoryUsage.rss() - before));
`;

/**
 * RSS held by the parsed artifacts, measured in a fresh process so earlier
 * corpora can't pollute the baseline. (Bun's in-process heapUsed deltas
 * read zero here, and RSS never shrinks back after frees.)
 */
function measureParsedMemoryMb(paths: string[]): number {
  const stdout = execFileSync("bun", ["-e", MEMORY_PROBE_SCRIPT], {
    env: { ...process.env, BENCH_PATHS: JSON.stringify(paths) },
  });
  const bytes = Number.parseInt(stdout.toString(), 10);
  return Number.isFinite(bytes) ? bytes / (1024 * 1024) : 0;
}

async function benchCorpus(spec: CorpusSpec): Promise<BenchRow> {
  const corpusDir = join(WORK_DIR, spec.name);
  const docsDir = join(corpusDir, "docs");
  await rm(corpusDir, { recursive: true, force: true });
  await mkdir(docsDir, { recursive: true });
  await spec.prepare(docsDir);

  const buildStart = performance.now();
  const generated = await generateDocsSearchFiles({
    outDir: corpusDir,
    baseUrl: "https://bench.example.com",
  });
  const buildMs = performance.now() - buildStart;

  const indexText = await readFile(generated.outputPath, "utf8");
  const contentText = generated.contentOutputPath
    ? await readFile(generated.contentOutputPath, "utf8")
    : "";

  const memMb = measureParsedMemoryMb([
    generated.outputPath,
    ...(generated.contentOutputPath ? [generated.contentOutputPath] : []),
  ]);
  const index = JSON.parse(indexText) as DocsSearchIndex;
  const content = contentText
    ? (JSON.parse(contentText) as DocsSearchContentStore)
    : undefined;

  const indexGzip = gzipSync(indexText).byteLength;
  const contentGzip = contentText ? gzipSync(contentText).byteLength : 0;
  const indexBrotli = brotliCompressSync(indexText).byteLength;
  const contentBrotli = contentText
    ? brotliCompressSync(contentText).byteLength
    : 0;

  const parseRuns: number[] = [];
  for (let run = 0; run < 5; run++) {
    const parseStart = performance.now();
    JSON.parse(indexText);
    if (contentText) {
      JSON.parse(contentText);
    }
    parseRuns.push(performance.now() - parseStart);
  }

  const allTimings: number[] = [];
  let slowestQuery = "";
  let slowestQueryMs = 0;
  for (const query of QUERIES) {
    for (let warmup = 0; warmup < QUERY_WARMUPS; warmup++) {
      searchDocs(index, query, { content });
    }
    const queryTimings: number[] = [];
    for (let iteration = 0; iteration < QUERY_ITERATIONS; iteration++) {
      const start = performance.now();
      searchDocs(index, query, { content });
      queryTimings.push(performance.now() - start);
    }
    allTimings.push(...queryTimings);
    const queryMedian = median(queryTimings);
    if (queryMedian > slowestQueryMs) {
      slowestQueryMs = queryMedian;
      slowestQuery = query;
    }
  }
  const sortedTimings = [...allTimings].sort((a, b) => a - b);

  const answerTimings: number[] = [];
  for (const query of ANSWER_QUERIES) {
    for (let iteration = 0; iteration < ANSWER_ITERATIONS; iteration++) {
      const start = performance.now();
      createAnswerContext(index, query, { content });
      answerTimings.push(performance.now() - start);
    }
  }

  return {
    name: spec.name,
    docs: generated.docs,
    chunks: generated.chunks,
    terms: generated.terms,
    buildMs,
    indexBytes: generated.indexBytes,
    contentBytes: generated.contentBytes,
    indexGzip,
    contentGzip,
    indexBrotli,
    contentBrotli,
    parseMs: median(parseRuns),
    memMb,
    queryP50: percentile(sortedTimings, 0.5),
    queryP95: percentile(sortedTimings, 0.95),
    queryMax: sortedTimings.at(-1) ?? 0,
    slowestQuery,
    slowestQueryMs,
    answerP50: median(answerTimings),
  };
}

function reportTable(rows: BenchRow[]): string {
  const lines = [
    "| corpus | docs | chunks | terms | build | index (raw/gzip/br) | content (raw/gzip/br) | parse | mem (rss) | search p50 | search p95 | slowest query | answer ctx p50 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.name} | ${row.docs} | ${row.chunks} | ${row.terms} | ${formatMs(row.buildMs)} | ${formatBytes(row.indexBytes)} / ${formatBytes(row.indexGzip)} / ${formatBytes(row.indexBrotli)} | ${formatBytes(row.contentBytes)} / ${formatBytes(row.contentGzip)} / ${formatBytes(row.contentBrotli)} | ${formatMs(row.parseMs)} | ${row.memMb.toFixed(1)} MB | ${formatMs(row.queryP50)} | ${formatMs(row.queryP95)} | ${row.slowestQuery} (${formatMs(row.slowestQueryMs)}) | ${formatMs(row.answerP50)} |`
    );
  }
  return lines.join("\n");
}

const specs: CorpusSpec[] = [];

if (existsSync(C15T_SRC)) {
  specs.push({ name: "c15t", prepare: prepareC15t });
} else {
  process.stderr.write(
    "Skipping c15t corpus — run `bun run pipeline:setup-real` first.\n"
  );
}

if (TANSTACK_FIXTURE_DIR && existsSync(TANSTACK_FIXTURE_DIR)) {
  specs.push(
    { name: "tanstack", prepare: makeTanstackPrepare(1) },
    { name: "tanstack-x2", prepare: makeTanstackPrepare(2) },
    { name: "tanstack-x4", prepare: makeTanstackPrepare(4) }
  );
} else {
  process.stderr.write(
    "Skipping tanstack corpora — set TANSTACK_FIXTURE_DIR to a directory containing router/docs and query/docs checkouts.\n"
  );
}

if (specs.length === 0) {
  process.stderr.write("No corpora available, nothing to benchmark.\n");
  process.exit(1);
}

const rows: BenchRow[] = [];
for (const spec of specs) {
  process.stdout.write(`Benchmarking ${spec.name}…\n`);
  rows.push(await benchCorpus(spec));
}

process.stdout.write(`\n${reportTable(rows)}\n`);
