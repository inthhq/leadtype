import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

type Transcript = {
  o11y: {
    filesRead: string[];
    filesModified: string[];
  } | null;
};

const transcript = JSON.parse(
  readFileSync("__agent_eval__/results.json", "utf-8")
) as Transcript;

const filesRead = transcript.o11y?.filesRead ?? [];
const filesModified = transcript.o11y?.filesModified ?? [];

test("agent discovered the bundled AGENTS.md", () => {
  const readAgentsMd = filesRead.some((path) =>
    path.includes("node_modules/leadtype/AGENTS.md")
  );
  expect(readAgentsMd).toBe(true);
});

test("agent read either validate-in-ci or cli reference", () => {
  const readRelevantTopic = filesRead.some(
    (path) =>
      path.includes("node_modules/leadtype/docs/build/validate-in-ci.md") ||
      path.includes("node_modules/leadtype/docs/reference/cli.md")
  );
  expect(readRelevantTopic).toBe(true);
});

test("workflow file was created at the right path", () => {
  expect(
    filesModified.some((path) =>
      path.endsWith(".github/workflows/lint-docs.yml")
    )
  ).toBe(true);
});

test("workflow uses the github format and strict flags", () => {
  const workflowPath = "__agent_eval__/files/.github/workflows/lint-docs.yml";
  if (!existsSync(workflowPath)) {
    throw new Error(`Workflow not copied out of sandbox: ${workflowPath}`);
  }
  const source = readFileSync(workflowPath, "utf-8");
  expect(source).toMatch(/leadtype lint/);
  expect(source).toMatch(/--format\s+github/);
  expect(source).toMatch(/--error-unknown/);
  expect(source).toMatch(/pull_request/);
});
