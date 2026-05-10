import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadLlmsExpected,
  selectionMatchesVariant,
  summarizeLlmsReads,
} from "./llms-metrics";
import { readTranscript } from "./transcript";

export async function assertLlmsFixture(fixtureUrl: URL): Promise<void> {
  const fixtureDir = fileURLToPath(fixtureUrl);
  const expected = loadLlmsExpected(fixtureDir);
  const transcript = await readTranscript();
  const selection = selectionMatchesVariant(transcript, expected);
  const summary = summarizeLlmsReads(transcript);
  if (!process.env.TRANSCRIPT_PATH) {
    throw new Error("TRANSCRIPT_PATH must be set");
  }
  const projectRoot = resolve(dirname(process.env.TRANSCRIPT_PATH), "..");
  const answerPath = resolve(projectRoot, "ANSWER.md");

  describe(transcript.fixture, () => {
    it("read the expected llms context for this variant", () => {
      expect(selection.reasons).toEqual([]);
    });

    it("did not read unrelated topic bundles", () => {
      expect(selection.wrongGroupReads).toEqual([]);
    });

    it("used an llms context source", () => {
      expect(
        summary.readLlmsTxt ||
          summary.readRootFull ||
          summary.sectionIndexReads.length > 0 ||
          summary.pageReads.length > 0 ||
          summary.groupReads.length > 0
      ).toBe(true);
    });

    it("wrote a grounded answer", () => {
      if (!existsSync(answerPath)) {
        throw new Error(`ANSWER.md not produced at ${answerPath}`);
      }
      const answer = readFileSync(answerPath, "utf-8");
      for (const pattern of expected.answerPatterns) {
        expect(answer).toMatch(new RegExp(pattern, "i"));
      }
      for (const pattern of expected.forbiddenAnswerPatterns ?? []) {
        expect(answer).not.toMatch(new RegExp(pattern, "i"));
      }
    });
  });
}
