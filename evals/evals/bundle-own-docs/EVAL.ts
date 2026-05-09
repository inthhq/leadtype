import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

type Transcript = {
  o11y: {
    filesRead: string[];
    filesModified: string[];
    shellCommands: { command: string }[];
  } | null;
};

const transcript = JSON.parse(
  readFileSync("__agent_eval__/results.json", "utf-8")
) as Transcript;

const filesRead = transcript.o11y?.filesRead ?? [];
const filesModified = transcript.o11y?.filesModified ?? [];
const shellCommands = (transcript.o11y?.shellCommands ?? []).map(
  (entry) => entry.command
);

test("agent read AGENTS.md", () => {
  expect(
    filesRead.some((path) => path.includes("node_modules/leadtype/AGENTS.md"))
  ).toBe(true);
});

test("agent read the bundle-package-docs guide", () => {
  expect(
    filesRead.some((path) =>
      path.includes("node_modules/leadtype/docs/build/bundle-package-docs.md")
    )
  ).toBe(true);
});

test("package.json has AGENTS.md in files and a prepack script using --bundle", () => {
  const pkgPath = "__agent_eval__/files/package.json";
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not copied out: ${pkgPath}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    files?: string[];
    scripts?: Record<string, string>;
  };
  expect(pkg.files ?? []).toContain("AGENTS.md");
  const prepack = pkg.scripts?.prepack ?? "";
  expect(prepack).toMatch(/leadtype/);
  expect(prepack).toMatch(/--bundle/);
});

test("agent ran npm pack --dry-run to verify", () => {
  expect(shellCommands.some((cmd) => /npm pack.*--dry-run/.test(cmd))).toBe(
    true
  );
});

test("a stub docs/index.mdx was created", () => {
  expect(filesModified.some((path) => path.endsWith("docs/index.mdx"))).toBe(
    true
  );
});
