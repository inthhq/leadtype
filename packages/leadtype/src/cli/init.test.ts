import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseInitArgs, runInitCommand } from "./init";

const tempDirs: string[] = [];

function createCapture() {
  const state = { stderr: "", stdout: "" };
  return {
    io: {
      stderr: {
        write: (chunk: string) => {
          state.stderr += chunk;
          return true;
        },
      },
      stdout: {
        write: (chunk: string) => {
          state.stdout += chunk;
          return true;
        },
      },
    },
    get stderr() {
      return state.stderr;
    },
    get stdout() {
      return state.stdout;
    },
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-init-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("parseInitArgs", () => {
  it("defaults to writing and generating", () => {
    const args = parseInitArgs([]);
    expect(args.dir).toBe(".");
    expect(args.generate).toBe(true);
    expect(args.dryRun).toBe(false);
  });

  it("parses framework and flags", () => {
    const args = parseInitArgs([
      "--framework",
      "astro",
      "--base-url",
      "https://x.dev",
      "--no-generate",
    ]);
    expect(args.framework).toBe("astro");
    expect(args.baseUrl).toBe("https://x.dev");
    expect(args.generate).toBe(false);
  });

  it("rejects unsupported frameworks", () => {
    expect(() => parseInitArgs(["--framework", "ember"])).toThrow(
      /unsupported framework/
    );
  });
});

describe("runInitCommand", () => {
  it("dry-run lists files without writing", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "next", "--dry-run"],
      capture.io
    );
    expect(code).toBe(0);
    expect(capture.stdout).toContain("would scaffold next");
    expect(capture.stdout).toContain("app/docs/[[...slug]]/page.tsx");
    expect(existsSync(path.join(dir, "docs/docs.config.ts"))).toBe(false);
  });

  it("--json emits the file plan", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "sveltekit", "--json"],
      capture.io
    );
    expect(code).toBe(0);
    const plan = JSON.parse(capture.stdout) as {
      framework: string;
      files: string[];
      outDir: string;
    };
    expect(plan.framework).toBe("sveltekit");
    expect(plan.outDir).toBe("static");
    expect(plan.files).toContain("src/routes/docs/[...slug].md/+server.ts");
  });

  it("writes framework files to disk", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "astro", "--no-generate"],
      capture.io
    );
    expect(code).toBe(0);
    expect(existsSync(path.join(dir, "docs/docs.config.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "astro.config.mjs"))).toBe(true);
    const config = await readFile(
      path.join(dir, "docs/docs.config.ts"),
      "utf8"
    );
    expect(config).toContain("defineDocsConfig");
  });

  it("skips existing files unless --force", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      capture.io
    );
    const second = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      second.io
    );
    expect(second.stdout).toContain("(exists, use --force)");
  });

  it("errors with exit 2 when no framework is detected", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    const code = await runInitCommand(["--dir", dir], capture.io);
    expect(code).toBe(2);
    expect(capture.stderr).toContain("could not detect a framework");
  });
});
