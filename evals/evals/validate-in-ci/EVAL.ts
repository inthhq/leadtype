import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../../lib/transcript";

const transcript = await readTranscript();
const projectRoot = process.env.TRANSCRIPT_PATH
  ? resolve(dirname(process.env.TRANSCRIPT_PATH), "..")
  : "";

const reads = transcript.toolCalls
  .filter((c) => c.tool === "read")
  .map((c) => (c.args.path as string) ?? "");

describe("validate-in-ci", () => {
  it("agent discovered the bundled AGENTS.md", () => {
    expect(
      reads.some((p) => p.includes("node_modules/leadtype/AGENTS.md"))
    ).toBe(true);
  });

  it("agent read either validate-in-ci or cli reference", () => {
    expect(
      reads.some(
        (p) =>
          p.includes("node_modules/leadtype/docs/build/validate-in-ci.md") ||
          p.includes("node_modules/leadtype/docs/reference/cli.md")
      )
    ).toBe(true);
  });

  it("workflow file was created at the right path", () => {
    expect(
      transcript.filesModified.some((p) =>
        p.endsWith(".github/workflows/lint-docs.yml")
      )
    ).toBe(true);
  });

  it("workflow uses the github format and strict flags", () => {
    const workflowPath = resolve(
      projectRoot,
      ".github/workflows/lint-docs.yml"
    );
    if (!existsSync(workflowPath)) {
      throw new Error(`workflow not at ${workflowPath}`);
    }
    const source = readFileSync(workflowPath, "utf-8");
    expect(source).toMatch(/leadtype lint/);
    expect(source).toMatch(/--format\s+github/);
    expect(source).toMatch(/--error-unknown/);
    expect(source).toMatch(/pull_request/);
  });
});
