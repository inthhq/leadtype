import { readFileSync } from "node:fs";
import path from "node:path";
import type { Transcript } from "./transcript";

export type LlmsExpected = {
  answerPatterns: string[];
  forbiddenAnswerPatterns?: string[];
  expectedGroups: string[];
  expectedPages: string[];
};

export type LlmsReadSummary = {
  readLlmsTxt: boolean;
  readRootFull: boolean;
  sectionIndexReads: string[];
  pageReads: string[];
  groupReads: string[];
};

export type SelectionResult = {
  passed: boolean;
  reasons: string[];
  wrongGroupReads: string[];
};

export function loadLlmsExpected(fixtureDir: string): LlmsExpected {
  const raw = readFileSync(path.join(fixtureDir, "expected.json"), "utf-8");
  return JSON.parse(raw) as LlmsExpected;
}

export function llmsReadPaths(transcript: Transcript): string[] {
  return transcript.toolCalls
    .filter((call) => call.tool === "read")
    .map((call) => call.args.path)
    .filter((value): value is string => typeof value === "string")
    .map(normalizeReadPath);
}

export function summarizeLlmsReads(transcript: Transcript): LlmsReadSummary {
  const reads = llmsReadPaths(transcript);
  const groupReads = reads
    .map((readPath) => readPath.match(/^docs\/llms-full\/([^/]+)\.txt$/)?.[1])
    .filter((group): group is string => typeof group === "string");
  const sectionIndexReads = reads
    .map((readPath) => readPath.match(/^docs\/([^/]+)\/llms\.txt$/)?.[1])
    .filter((group): group is string => typeof group === "string");

  return {
    readLlmsTxt: reads.includes("llms.txt"),
    readRootFull: reads.includes("llms-full.txt"),
    sectionIndexReads,
    pageReads: reads.filter(
      (readPath) =>
        readPath.startsWith("docs/") &&
        readPath.endsWith(".md") &&
        !readPath.startsWith("docs/llms-full/")
    ),
    groupReads,
  };
}

export function selectionMatchesVariant(
  transcript: Transcript,
  expected: LlmsExpected
): SelectionResult {
  const summary = summarizeLlmsReads(transcript);
  const reasons: string[] = [];
  if (!summary.readLlmsTxt) {
    reasons.push("did not read llms.txt");
  }

  if (transcript.variant === "page-links") {
    for (const expectedPage of expected.expectedPages) {
      if (!summary.pageReads.includes(expectedPage)) {
        reasons.push(`did not read page ${expectedPage}`);
      }
    }
  } else if (transcript.variant === "explicit-bundles") {
    requireExpectedGroups(expected, summary, reasons);
  } else if (transcript.variant === "monolith") {
    if (!summary.readRootFull) {
      reasons.push("did not read llms-full.txt");
    }
  } else if (transcript.variant === "router") {
    if (!summary.readRootFull) {
      reasons.push("did not read llms-full.txt router");
    }
    requireExpectedGroups(expected, summary, reasons);
  } else if (transcript.variant === "section-indexes") {
    requireExpectedSectionIndexes(expected, summary, reasons);
    requireExpectedPagesOrSectionBundles(expected, summary, reasons);
  } else {
    reasons.push("transcript variant is missing or unknown");
  }

  const expectedGroupSet = new Set(expected.expectedGroups);
  const wrongGroupReads = summary.groupReads.filter(
    (group) => !expectedGroupSet.has(group)
  );

  return {
    passed: reasons.length === 0 && (wrongGroupReads?.length ?? 0) === 0,
    reasons,
    wrongGroupReads,
  };
}

function normalizeReadPath(readPath: string): string {
  return readPath
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function requireExpectedGroups(
  expected: LlmsExpected,
  summary: LlmsReadSummary,
  reasons: string[]
): void {
  for (const group of expected.expectedGroups) {
    if (!summary.groupReads.includes(group)) {
      reasons.push(`did not read group bundle ${group}`);
    }
  }
}

function requireExpectedSectionIndexes(
  expected: LlmsExpected,
  summary: LlmsReadSummary,
  reasons: string[]
): void {
  for (const group of expected.expectedGroups) {
    if (!summary.sectionIndexReads.includes(group)) {
      reasons.push(`did not read section index ${group}`);
    }
  }
}

function requireExpectedPagesOrSectionBundles(
  expected: LlmsExpected,
  summary: LlmsReadSummary,
  reasons: string[]
): void {
  for (const expectedPage of expected.expectedPages) {
    const pageGroup = groupForPage(expectedPage);
    const sectionBundleRead =
      pageGroup !== undefined && summary.groupReads.includes(pageGroup);
    if (!(summary.pageReads.includes(expectedPage) || sectionBundleRead)) {
      reasons.push(`did not read page or section bundle for ${expectedPage}`);
    }
  }
}

function groupForPage(pagePath: string): string | undefined {
  if (pagePath.startsWith("docs/authoring/")) {
    return "authoring";
  }
  if (pagePath.startsWith("docs/build/")) {
    return "build";
  }
  if (pagePath.startsWith("docs/reference/")) {
    return "reference";
  }
  if (
    pagePath === "docs/quickstart.md" ||
    pagePath === "docs/how-it-works.md"
  ) {
    return "get-started";
  }
  return;
}
