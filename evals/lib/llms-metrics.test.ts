import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type LlmsExpected,
  selectionMatchesVariant,
  summarizeLlmsReads,
} from "./llms-metrics";
import { materializeLlmsVariant } from "./llms-variants";
import type { ToolCall, Transcript } from "./transcript";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "llms-metrics-test-"));
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

const expected: LlmsExpected = {
  answerPatterns: [],
  expectedGroups: ["reference"],
  expectedPages: ["docs/reference/cli.md"],
};

function transcriptFor(paths: string[], variant: Transcript["variant"]) {
  const toolCalls: ToolCall[] = paths.map((readPath) => ({
    tool: "read",
    args: { path: readPath },
    durationMs: 0,
  }));

  return {
    fixture: "fixture",
    benchmark: "llms",
    mode: "treatment",
    variant,
    agent: { provider: "anthropic", model: "test" },
    toolCalls,
    filesModified: [],
    finalText: "",
    durationMs: 0,
    steps: 0,
    errors: [],
    tokens: { input: 0, output: 0 },
  } satisfies Transcript;
}

describe("llms variant materialization", () => {
  it("distinguishes router and monolith root full-context files", async () => {
    await materializeLlmsVariant({ tempDir, variant: "router" });
    const router = await readFile(path.join(tempDir, "llms-full.txt"), "utf-8");
    expect(router).toContain("Full Context Router");
    expect(router).toContain("/docs/llms-full/reference.txt");

    await rm(tempDir, { force: true, recursive: true });
    tempDir = await mkdtemp(path.join(tmpdir(), "llms-metrics-test-"));
    await materializeLlmsVariant({ tempDir, variant: "monolith" });
    const monolith = await readFile(
      path.join(tempDir, "llms-full.txt"),
      "utf-8"
    );
    expect(monolith).toContain("All generated markdown docs pages");
    expect(monolith).toContain("isAgentReadabilityArtifactPath");
  });

  it("writes section indexes with page links and optional full context", async () => {
    await materializeLlmsVariant({ tempDir, variant: "section-indexes" });
    const rootIndex = await readFile(path.join(tempDir, "llms.txt"), "utf-8");
    expect(rootIndex).toContain("/docs/reference/llms.txt");

    const sectionIndex = await readFile(
      path.join(tempDir, "docs", "reference", "llms.txt"),
      "utf-8"
    );
    expect(sectionIndex).toContain("/docs/reference/cli.md");
    expect(sectionIndex).toContain("/docs/llms-full/reference.txt");
  });
});

describe("selectionMatchesVariant", () => {
  it("accepts page-level reads for the page-links variant", () => {
    const transcript = transcriptFor(
      ["/llms.txt", "/docs/reference/cli.md"],
      "page-links"
    );

    expect(selectionMatchesVariant(transcript, expected).passed).toBe(true);
  });

  it("accepts router reads only when the router and expected bundle are read", () => {
    const transcript = transcriptFor(
      ["/llms.txt", "/llms-full.txt", "/docs/llms-full/reference.txt"],
      "router"
    );

    expect(selectionMatchesVariant(transcript, expected).passed).toBe(true);
  });

  it("accepts section index reads with expected page reads", () => {
    const transcript = transcriptFor(
      ["/llms.txt", "/docs/reference/llms.txt", "/docs/reference/cli.md"],
      "section-indexes"
    );

    expect(selectionMatchesVariant(transcript, expected).passed).toBe(true);
  });

  it("accepts section index reads with the optional section bundle", () => {
    const transcript = transcriptFor(
      [
        "/llms.txt",
        "/docs/reference/llms.txt",
        "/docs/llms-full/reference.txt",
      ],
      "section-indexes"
    );

    expect(selectionMatchesVariant(transcript, expected).passed).toBe(true);
  });

  it("reports unrelated topic bundles", () => {
    const transcript = transcriptFor(
      ["/llms.txt", "/docs/llms-full/build.txt"],
      "explicit-bundles"
    );

    const result = selectionMatchesVariant(transcript, expected);
    expect(result.passed).toBe(false);
    expect(result.wrongGroupReads).toEqual(["build"]);
  });

  it("summarizes page, root, and group reads", () => {
    const transcript = transcriptFor(
      ["/llms.txt", "/llms-full.txt", "/docs/llms-full/reference.txt"],
      "router"
    );

    expect(summarizeLlmsReads(transcript)).toMatchObject({
      readLlmsTxt: true,
      readRootFull: true,
      sectionIndexReads: [],
      groupReads: ["reference"],
    });
  });
});
