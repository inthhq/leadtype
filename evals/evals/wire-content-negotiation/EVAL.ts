import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

type Transcript = {
  o11y: {
    filesRead: string[];
    filesModified: string[];
    shellCommands: { command: string }[];
    totalToolCalls: number;
  } | null;
};

const transcript = JSON.parse(
  readFileSync("__agent_eval__/results.json", "utf-8")
) as Transcript;

const filesRead = transcript.o11y?.filesRead ?? [];
const filesModified = transcript.o11y?.filesModified ?? [];

test("agent discovered the bundled AGENTS.md", () => {
  // The discovery signal: did the agent open AGENTS.md before grepping at random?
  const readAgentsMd = filesRead.some((path) =>
    path.includes("node_modules/leadtype/AGENTS.md")
  );
  expect(
    readAgentsMd,
    "agent did not read node_modules/leadtype/AGENTS.md"
  ).toBe(true);
});

test("agent followed AGENTS.md to the connect-docs-site topic", () => {
  const readTopic = filesRead.some((path) =>
    path.includes("node_modules/leadtype/docs/build/connect-docs-site.md")
  );
  expect(
    readTopic,
    "agent did not read the connect-docs-site topic via AGENTS.md links"
  ).toBe(true);
});

test("vite.config.ts was modified", () => {
  expect(filesModified.some((path) => path.endsWith("vite.config.ts"))).toBe(
    true
  );
});

test("middleware sets charset=utf-8", () => {
  // Reading the agent's output: charset must be set explicitly to avoid mojibake.
  // The agent-eval framework copies modified files into __agent_eval__/files/
  // when copyFiles: "changed" is set on the experiment.
  const viteConfigPath = "__agent_eval__/files/vite.config.ts";
  if (!existsSync(viteConfigPath)) {
    throw new Error(
      "vite.config.ts was not copied out of the sandbox; check experiment copyFiles config"
    );
  }
  const source = readFileSync(viteConfigPath, "utf-8");
  expect(source).toMatch(/charset=utf-8/i);
});

test("middleware rewrites /docs/* paths to .md", () => {
  const viteConfigPath = "__agent_eval__/files/vite.config.ts";
  const source = readFileSync(viteConfigPath, "utf-8");
  expect(source).toMatch(/\/docs/);
  expect(source).toMatch(/\.md/);
  expect(source).toMatch(/text\/(markdown|plain)/i);
});
