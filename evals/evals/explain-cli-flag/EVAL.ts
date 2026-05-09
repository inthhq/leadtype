import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../../lib/transcript";

const transcript = await readTranscript();
const projectRoot = process.env.TRANSCRIPT_PATH
  ? resolve(dirname(process.env.TRANSCRIPT_PATH), "..")
  : "";

const reads = transcript.toolCalls
  .filter((c) => c.tool === "read" && typeof c.args.path === "string")
  .map((c) => c.args.path as string);

describe("explain-cli-flag", () => {
  it("agent read AGENTS.md", () => {
    expect(
      reads.some((p) => p.includes("node_modules/leadtype/AGENTS.md"))
    ).toBe(true);
  });

  it("agent read the CLI reference", () => {
    expect(
      reads.some((p) =>
        p.includes("node_modules/leadtype/docs/reference/cli.md")
      )
    ).toBe(true);
  });

  it("answer mentions lastModified and lastAuthor", () => {
    const answerPath = resolve(projectRoot, "ANSWER.md");
    if (!existsSync(answerPath)) {
      throw new Error(`ANSWER.md not produced at ${answerPath}`);
    }
    const answer = readFileSync(answerPath, "utf-8");
    expect(answer).toMatch(/lastModified/);
    expect(answer).toMatch(/lastAuthor/);
    expect(answer).toMatch(/git/i);
  });
});
