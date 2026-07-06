import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aggregateRun } from "./aggregate";
import type { RunRecord } from "./record";

let runDir: string;

beforeEach(async () => {
  runDir = await mkdtemp(path.join(tmpdir(), "aggregate-test-"));
});

afterEach(async () => {
  await rm(runDir, { force: true, recursive: true });
});

function record(
  over: Partial<RunRecord> & { mode: RunRecord["mode"] }
): RunRecord {
  return {
    benchmark: "package",
    fixture: "demo",
    model: "test-model",
    runIndex: 1,
    passed: true,
    score: 100,
    judgeModel: "gemini-3-pro",
    judgeReasoning: "ok",
    usedBundle: false,
    toolCalls: 5,
    inputTokens: 1000,
    outputTokens: 100,
    durationMs: 1000,
    steps: 3,
    errors: [],
    ...over,
  };
}

async function writeRecords(records: RunRecord[]): Promise<void> {
  for (const [i, r] of records.entries()) {
    const dir = path.join(
      runDir,
      "runs",
      r.fixture,
      r.mode ?? "?",
      r.model,
      `run-${i + 1}`
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "record.json"),
      `${JSON.stringify({ ...r, runIndex: i + 1 }, null, 2)}\n`
    );
  }
}

describe("aggregateRun — package arms", () => {
  it("emits armDeltas and a pointer section when a pointer arm is present", async () => {
    await writeRecords([
      record({ mode: "treatment", passed: true, usedBundle: true }),
      record({ mode: "control", passed: false, usedBundle: false }),
      record({ mode: "pointer", passed: true, usedBundle: true }),
    ]);

    const summary = await aggregateRun(runDir);

    expect(summary.arms).toContain("pointer");
    expect(summary.armDeltas).toBeDefined();
    expect(summary.armDeltas?.[0]).toMatchObject({
      arm: "pointer",
      armRate: 1,
      controlRate: 0,
      delta: 1,
    });
    // Treatment-vs-control deltas still computed independently.
    expect(summary.deltas?.[0]).toMatchObject({ delta: 1 });

    const report = await readFile(path.join(runDir, "report.md"), "utf-8");
    expect(report).toContain("Recommended setup");
    expect(report).toContain("Bundle read (pointer)");
  });

  it("renders an arm-decomposition table when bare/pointer arms are present", async () => {
    await writeRecords([
      record({ mode: "bare", passed: false }),
      record({ mode: "control", passed: false }),
      record({ mode: "treatment", passed: true }),
      record({ mode: "pointer", passed: true }),
    ]);

    const summary = await aggregateRun(runDir);
    expect(summary.arms).toEqual(
      expect.arrayContaining(["bare", "control", "treatment", "pointer"])
    );

    const report = await readFile(path.join(runDir, "report.md"), "utf-8");
    expect(report).toContain("Arm decomposition");
    // Columns ordered by increasing information.
    expect(report).toMatch(
      /\| Model \| bare \| control \| treatment \| pointer \|/
    );
  });

  it("surfaces a confident-wrong rate and failure-modes section", async () => {
    await writeRecords([
      record({ mode: "treatment", passed: true, failureMode: "none" }),
      record({
        mode: "control",
        passed: false,
        score: 30,
        failureMode: "confident_wrong",
      }),
    ]);

    const summary = await aggregateRun(runDir);
    const controlCell = summary.cells.find((c) => c.arm === "control");
    const treatmentCell = summary.cells.find((c) => c.arm === "treatment");
    expect(controlCell?.confidentWrongRate).toBe(1);
    expect(treatmentCell?.confidentWrongRate).toBe(0);

    const report = await readFile(path.join(runDir, "report.md"), "utf-8");
    expect(report).toContain("Failure modes");
    expect(report).toContain("Confident-wrong");
  });

  it("leaves a plain treatment/control run untouched (no armDeltas, no pointer section)", async () => {
    await writeRecords([
      record({ mode: "treatment", passed: true }),
      record({ mode: "control", passed: false }),
    ]);

    const summary = await aggregateRun(runDir);

    expect(summary.armDeltas).toBeUndefined();
    const report = await readFile(path.join(runDir, "report.md"), "utf-8");
    expect(report).not.toContain("Recommended setup");
  });
});
