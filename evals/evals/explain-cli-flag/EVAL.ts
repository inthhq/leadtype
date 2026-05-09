import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

type Transcript = {
  o11y: {
    filesRead: string[];
  } | null;
};

const transcript = JSON.parse(
  readFileSync("__agent_eval__/results.json", "utf-8")
) as Transcript;

const filesRead = transcript.o11y?.filesRead ?? [];

test("agent read AGENTS.md", () => {
  expect(
    filesRead.some((path) => path.includes("node_modules/leadtype/AGENTS.md"))
  ).toBe(true);
});

test("agent read the CLI reference", () => {
  expect(
    filesRead.some((path) =>
      path.includes("node_modules/leadtype/docs/reference/cli.md")
    )
  ).toBe(true);
});

test("answer mentions lastModified and lastAuthor", () => {
  const answerPath = "__agent_eval__/files/ANSWER.md";
  if (!existsSync(answerPath)) {
    throw new Error(`ANSWER.md not produced: ${answerPath}`);
  }
  const answer = readFileSync(answerPath, "utf-8");
  expect(answer).toMatch(/lastModified/);
  expect(answer).toMatch(/lastAuthor/);
  expect(answer).toMatch(/git/i);
});
