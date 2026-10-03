import { describe, expect, it } from "vitest";
import { summarizePackageReads } from "./package-metrics";
import type { ToolCall } from "./transcript";

function read(path: string, opts?: Partial<ToolCall>): ToolCall {
  return {
    tool: "read",
    args: { path },
    resultSummary: "ok",
    durationMs: 0,
    ...opts,
  };
}

describe("summarizePackageReads", () => {
  it("counts a successful AGENTS.md read as bundle usage", () => {
    const result = summarizePackageReads([
      read("node_modules/leadtype/AGENTS.md"),
    ]);
    expect(result).toEqual({
      discoveredAgentsMd: true,
      readBundledDocs: false,
      usedBundle: true,
    });
  });

  it("counts a successful bundled docs read", () => {
    const result = summarizePackageReads([
      read("node_modules/leadtype/docs/reference/cli.md"),
    ]);
    expect(result).toEqual({
      discoveredAgentsMd: false,
      readBundledDocs: true,
      usedBundle: true,
    });
  });

  it("does NOT count a failed read of a stripped bundle (control)", () => {
    // This is the bug the metric guards against: in control mode the bundle is
    // deleted, so the agent's read throws ENOENT. The attempt must not register
    // as bundle usage.
    const isErrorFlag = summarizePackageReads([
      read("node_modules/leadtype/AGENTS.md", {
        isError: true,
        resultSummary: "error: ENOENT: no such file or directory",
      }),
    ]);
    expect(isErrorFlag.usedBundle).toBe(false);

    // Older transcripts have no isError flag — fall back to the error: prefix.
    const prefixOnly = summarizePackageReads([
      read("node_modules/leadtype/docs/reference/cli.md", {
        isError: undefined,
        resultSummary: "error: ENOENT: no such file or directory",
      }),
    ]);
    expect(prefixOnly.usedBundle).toBe(false);
  });

  it("ignores non-bundle reads and non-read calls", () => {
    const result = summarizePackageReads([
      read("README.md"),
      read("src/index.ts"),
      { tool: "grep", args: { pattern: "AGENTS.md" }, durationMs: 0 },
    ]);
    expect(result.usedBundle).toBe(false);
  });
});
