import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      "--webmcp",
    ]);
    expect(args.framework).toBe("astro");
    expect(args.baseUrl).toBe("https://x.dev");
    expect(args.generate).toBe(false);
    expect(args.webmcp).toBe(true);
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

  it("--webmcp adds framework-specific browser registration files", async () => {
    const cases = [
      {
        framework: "next",
        expected: "components/leadtype-webmcp.tsx",
      },
      {
        framework: "nuxt",
        expected: "app/plugins/leadtype-webmcp.client.ts",
      },
      {
        framework: "sveltekit",
        expected: "src/lib/leadtype-webmcp.ts",
      },
    ] as const;

    for (const testCase of cases) {
      const dir = await createTempDir();
      const capture = createCapture();
      await runInitCommand(
        ["--dir", dir, "--framework", testCase.framework, "--webmcp", "--json"],
        capture.io
      );
      const plan = JSON.parse(capture.stdout) as { files: string[] };
      expect(plan.files).toContain(testCase.expected);
    }
  });

  it("--webmcp updates Astro's generated docs page in place", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "astro", "--webmcp", "--no-generate"],
      capture.io
    );

    const page = await readFile(
      path.join(dir, "src/pages/docs/[...slug].astro"),
      "utf8"
    );
    expect(page).toContain("leadtype/webmcp");
    expect(page).toContain("registerWebMcpTools");
  });

  it("does not add WebMCP scaffolding unless --webmcp is passed", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--json"],
      capture.io
    );

    const plan = JSON.parse(capture.stdout) as { files: string[] };
    expect(plan.files).not.toContain("components/leadtype-webmcp.tsx");
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

  it("auto-detects the framework from package.json dependencies", async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } })
    );
    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--no-generate"],
      capture.io
    );
    expect(code).toBe(0);
    expect(capture.stdout).toContain("scaffolded next");
  });

  it("adds a docs:generate script and leaves an existing one untouched", async () => {
    const dir = await createTempDir();
    const pkgPath = path.join(dir, "package.json");
    await writeFile(pkgPath, JSON.stringify({ name: "x", scripts: {} }));
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      createCapture().io
    );
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["docs:generate"]).toContain("leadtype generate");
    expect(pkg.scripts["docs:generate"]).toContain("--out public");

    // A project that already defines docs:generate keeps its own command.
    await writeFile(
      pkgPath,
      JSON.stringify({ name: "x", scripts: { "docs:generate": "custom" } })
    );
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate", "--force"],
      createCapture().io
    );
    const pkg2 = JSON.parse(await readFile(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg2.scripts["docs:generate"]).toBe("custom");
  });

  it("creates a root AGENTS.md with the leadtype pointer when none exists", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      capture.io
    );
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("node_modules/leadtype/AGENTS.md");
    expect(agents).toContain("<!-- leadtype:start -->");
    expect(agents).toContain("<!-- leadtype:end -->");
    expect(capture.stdout).toContain(
      "AGENTS.md (created leadtype docs pointer)"
    );
  });

  it("appends the pointer to an existing AGENTS.md without clobbering it", async () => {
    const dir = await createTempDir();
    const agentsPath = path.join(dir, "AGENTS.md");
    await writeFile(agentsPath, "# My project\n\nHand-written guidance.\n");
    const capture = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      capture.io
    );
    const agents = await readFile(agentsPath, "utf8");
    expect(agents).toContain("Hand-written guidance.");
    expect(agents).toContain("node_modules/leadtype/AGENTS.md");
    expect(capture.stdout).toContain(
      "AGENTS.md (appended leadtype docs pointer)"
    );
  });

  it("refreshes the marked block in place on re-run (idempotent)", async () => {
    const dir = await createTempDir();
    const agentsPath = path.join(dir, "AGENTS.md");
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      createCapture().io
    );
    const second = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate", "--force"],
      second.io
    );
    const agents = await readFile(agentsPath, "utf8");
    const occurrences = agents.split("<!-- leadtype:start -->").length - 1;
    expect(occurrences).toBe(1);
    expect(second.stdout).toContain(
      "AGENTS.md (refreshed leadtype docs pointer)"
    );
  });

  it("does not write AGENTS.md on --dry-run", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--dry-run"],
      capture.io
    );
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    expect(capture.stdout).toContain(
      "AGENTS.md (created leadtype docs pointer)"
    );
  });

  it("lists AGENTS.md in the --json plan", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--json"],
      capture.io
    );
    const plan = JSON.parse(capture.stdout) as { files: string[] };
    expect(plan.files).toContain("AGENTS.md");
  });

  it("reports the AGENTS.md action in the --json plan", async () => {
    const dir = await createTempDir();
    const fresh = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--json"],
      fresh.io
    );
    const freshPlan = JSON.parse(fresh.stdout) as {
      agentsPointer: { action: string; path: string };
    };
    expect(freshPlan.agentsPointer).toEqual({
      action: "created",
      path: "AGENTS.md",
    });

    // An existing user file with the marker block should plan a refresh, not a
    // create — the plan must reflect the larger blast radius without writing.
    await writeFile(
      path.join(dir, "AGENTS.md"),
      "# House rules\n\n<!-- leadtype:start -->\nold\n<!-- leadtype:end -->\n",
      "utf8"
    );
    const existing = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--json"],
      existing.io
    );
    const existingPlan = JSON.parse(existing.stdout) as {
      agentsPointer: { action: string };
    };
    expect(existingPlan.agentsPointer.action).toBe("refreshed");
    // --json must not have mutated the file.
    expect(await readFile(path.join(dir, "AGENTS.md"), "utf8")).toContain(
      "old"
    );
  });
});
