import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("rejects an invalid --base-url with the config validator's rules", () => {
    expect(() => parseInitArgs(["--base-url", "acme.dev"])).toThrow(
      /--base-url "acme.dev" is not an absolute URL/
    );
    expect(() => parseInitArgs(["--base-url", "https://acme.dev?"])).toThrow(
      /must not carry a query or fragment/
    );
  });

  it("normalizes --base-url the way the config loader would", () => {
    const args = parseInitArgs(["--base-url", "https://acme.dev/handbook/"]);
    expect(args.baseUrl).toBe("https://acme.dev/handbook");
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
      warnings: string[];
    };
    expect(plan.framework).toBe("sveltekit");
    expect(plan.outDir).toBe("static");
    expect(plan.files).toContain("src/routes/docs/[...slug].md/+server.ts");
    // `warnings` is always present: an empty array says positively that the
    // plan is clean, instead of the field's absence carrying that meaning.
    expect(plan.warnings).toEqual([]);
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

  it("--webmcp warns that the flag is deprecated", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "next", "--webmcp", "--no-generate"],
      capture.io
    );

    expect(code).toBe(0);
    expect(capture.stderr).toContain("--webmcp is deprecated");
    expect(capture.stderr).toContain("leadtype/webmcp");
  });

  it("--webmcp wires the SvelteKit docs page to the svelte hook", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    await runInitCommand(
      ["--dir", dir, "--framework", "sveltekit", "--webmcp", "--no-generate"],
      capture.io
    );

    const page = await readFile(
      path.join(dir, "src/routes/docs/[...slug]/+page.svelte"),
      "utf8"
    );
    expect(page).toContain("leadtype/webmcp/svelte");
    expect(page).toContain("useLeadtypeWebMcp()");
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
    expect(page).toContain("registerDocsWebMcpTools");
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

  it("writes baseUrl once, into the config — nowhere else", async () => {
    const dir = await createTempDir();
    await runInitCommand(
      [
        "--dir",
        dir,
        "--framework",
        "next",
        "--base-url",
        "https://acme.dev",
        "--no-generate",
      ],
      createCapture().io
    );

    const config = await readFile(
      path.join(dir, "docs/docs.config.ts"),
      "utf8"
    );
    expect(config).toContain('baseUrl: "https://acme.dev"');

    // The runtime source discovers the config, so it repeats nothing.
    const source = await readFile(path.join(dir, "lib/source.ts"), "utf8");
    expect(source).toContain("createDocsProject()");
    expect(source).not.toContain("baseUrl:");
  });

  it("fails an invalid --base-url as a usage error, writing nothing", async () => {
    const dir = await createTempDir();
    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "next", "--base-url", "acme.dev"],
      capture.io
    );

    expect(code).toBe(2);
    expect(capture.stderr).toContain('"acme.dev" is not an absolute URL');
    expect(capture.stderr).toContain("Usage:");
    expect(existsSync(path.join(dir, "docs/docs.config.ts"))).toBe(false);
    expect(existsSync(path.join(dir, "next.config.mjs"))).toBe(false);
  });

  it("writes the normalized form of a --base-url with a trailing slash", async () => {
    const dir = await createTempDir();
    await runInitCommand(
      [
        "--dir",
        dir,
        "--framework",
        "next",
        "--base-url",
        "https://acme.dev/",
        "--no-generate",
      ],
      createCapture().io
    );

    const config = await readFile(
      path.join(dir, "docs/docs.config.ts"),
      "utf8"
    );
    expect(config).toContain('baseUrl: "https://acme.dev"');
  });

  it("defaults baseUrl to the framework dev URL in the config", async () => {
    const dir = await createTempDir();
    await runInitCommand(
      ["--dir", dir, "--framework", "sveltekit", "--no-generate"],
      createCapture().io
    );

    const config = await readFile(
      path.join(dir, "docs/docs.config.ts"),
      "utf8"
    );
    expect(config).toContain('baseUrl: "http://localhost:5173"');
    const source = await readFile(path.join(dir, "src/lib/source.ts"), "utf8");
    expect(source).not.toContain("baseUrl:");
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

  it("refuses --base-url when the existing config would be skipped", async () => {
    const dir = await createTempDir();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      createCapture().io
    );
    const before = await readFile(
      path.join(dir, "docs/docs.config.ts"),
      "utf8"
    );

    const second = createCapture();
    const code = await runInitCommand(
      [
        "--dir",
        dir,
        "--framework",
        "next",
        "--base-url",
        "https://production.example",
        "--no-generate",
      ],
      second.io
    );

    // The flag's only destination is the config writeFiles would skip —
    // refusing beats silently generating against the stale value.
    expect(code).toBe(2);
    expect(second.stderr).toContain("docs/docs.config.ts already exists");
    expect(second.stderr).toContain("--force");
    expect(await readFile(path.join(dir, "docs/docs.config.ts"), "utf8")).toBe(
      before
    );
  });

  it("applies --base-url to an existing config with --force", async () => {
    const dir = await createTempDir();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      createCapture().io
    );

    const second = createCapture();
    const code = await runInitCommand(
      [
        "--dir",
        dir,
        "--framework",
        "next",
        "--base-url",
        "https://production.example",
        "--no-generate",
        "--force",
      ],
      second.io
    );

    expect(code).toBe(0);
    const config = await readFile(
      path.join(dir, "docs/docs.config.ts"),
      "utf8"
    );
    expect(config).toContain('baseUrl: "https://production.example"');
  });

  it("keeps the --json plan on a --base-url conflict, carried as a warning", async () => {
    const dir = await createTempDir();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      createCapture().io
    );
    const before = await readFile(
      path.join(dir, "docs/docs.config.ts"),
      "utf8"
    );

    const second = createCapture();
    const code = await runInitCommand(
      [
        "--dir",
        dir,
        "--framework",
        "next",
        "--base-url",
        "https://production.example",
        "--json",
      ],
      second.io
    );

    // --json is documented as "no writes", so the write-path refusal's
    // rationale does not apply — the plan object survives, honest about the
    // conflict a real run refuses on.
    expect(code).toBe(0);
    expect(second.stderr).toBe("");
    const plan = JSON.parse(second.stdout) as { warnings?: string[] };
    expect(plan.warnings).toEqual([
      expect.stringContaining("docs/docs.config.ts already exists"),
    ]);
    expect(await readFile(path.join(dir, "docs/docs.config.ts"), "utf8")).toBe(
      before
    );
  });

  it("keeps the --dry-run plan on a --base-url conflict, warning about the write path", async () => {
    const dir = await createTempDir();
    await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      createCapture().io
    );
    const before = await readFile(
      path.join(dir, "docs/docs.config.ts"),
      "utf8"
    );

    const second = createCapture();
    const code = await runInitCommand(
      [
        "--dir",
        dir,
        "--framework",
        "next",
        "--base-url",
        "https://production.example",
        "--dry-run",
      ],
      second.io
    );

    expect(code).toBe(0);
    expect(second.stdout).toContain("would scaffold next");
    expect(second.stdout).toContain("(exists, use --force)");
    expect(second.stderr).toContain("--base-url would be ignored");
    expect(second.stderr).toContain("exit 2");
    expect(await readFile(path.join(dir, "docs/docs.config.ts"), "utf8")).toBe(
      before
    );
  });

  async function writeExistingConfig(
    dir: string,
    body: string
  ): Promise<string> {
    const configPath = path.join(dir, "docs/docs.config.ts");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, body, "utf8");
    return configPath;
  }

  it("proceeds over a config that omits baseUrl, noting both resolutions", async () => {
    const dir = await createTempDir();
    // An older scaffold (or hand-written config) without the baseUrl field.
    // Deliberately leaving it unset is how a site picks its production URL up
    // from the deployment env vars at generate time, so a rerun must not
    // refuse — it proceeds and names the two resolutions.
    const configPath = await writeExistingConfig(
      dir,
      `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};
`
    );
    const before = await readFile(configPath, "utf8");

    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "astro", "--no-generate"],
      capture.io
    );

    expect(code).toBe(0);
    expect(capture.stdout).toContain("(exists, use --force)");
    expect(capture.stderr).toContain("note:");
    expect(capture.stderr).toContain("does not set baseUrl");
    expect(capture.stderr).toContain("NEXT_PUBLIC_SITE_URL");
    expect(capture.stderr).toContain("set baseUrl in docs/docs.config.ts");
    // The note must not read as a refusal, and must not prescribe pinning the
    // dev URL into the config.
    expect(capture.stderr).not.toContain("exit 2");
    expect(capture.stderr).not.toContain('baseUrl: "http://localhost:4321"');
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect(existsSync(path.join(dir, "astro.config.mjs"))).toBe(true);
  });

  it("previews the missing-baseUrl note in --json and --dry-run", async () => {
    const dir = await createTempDir();
    const configPath = await writeExistingConfig(
      dir,
      `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};
`
    );
    const before = await readFile(configPath, "utf8");

    const json = createCapture();
    expect(
      await runInitCommand(
        ["--dir", dir, "--framework", "astro", "--json"],
        json.io
      )
    ).toBe(0);
    expect(json.stderr).toBe("");
    const plan = JSON.parse(json.stdout) as { warnings?: string[] };
    expect(plan.warnings).toEqual([
      expect.stringContaining("does not set baseUrl"),
    ]);

    const dry = createCapture();
    expect(
      await runInitCommand(
        ["--dir", dir, "--framework", "astro", "--dry-run"],
        dry.io
      )
    ).toBe(0);
    expect(dry.stdout).toContain("would scaffold astro");
    expect(dry.stderr).toContain("does not set baseUrl");
    // Unlike the --base-url conflict, a real run proceeds — the note must not
    // claim otherwise.
    expect(dry.stderr).not.toContain("exit 2");
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect(existsSync(path.join(dir, "astro.config.mjs"))).toBe(false);
  });

  it("reruns quietly when the existing config already sets baseUrl", async () => {
    const dir = await createTempDir();
    const configPath = await writeExistingConfig(
      dir,
      `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  baseUrl: "https://acme.dev",
};
`
    );
    const before = await readFile(configPath, "utf8");

    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "astro", "--no-generate"],
      capture.io
    );

    expect(code).toBe(0);
    expect(capture.stderr).toBe("");
    expect(capture.stdout).toContain("(exists, use --force)");
    expect(await readFile(configPath, "utf8")).toBe(before);
  });

  it("permits a config without baseUrl when the framework default is the generic dev URL", async () => {
    const dir = await createTempDir();
    await writeExistingConfig(
      dir,
      `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};
`
    );

    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "next", "--no-generate"],
      capture.io
    );

    // Next's default is http://localhost:3000 — exactly where a missing
    // baseUrl falls back to — so skipping the config loses nothing.
    expect(code).toBe(0);
    expect(capture.stderr).toBe("");
  });

  it("stays silent when the config cannot be loaded — null is not missing baseUrl", async () => {
    const dir = await createTempDir();
    // Unloadable on purpose (the package does not exist), and *also* without
    // baseUrl: if the loader ever resolved this module, the config would load
    // without the field and the note would fire — so the empty stderr below
    // holds only via the loader returning null, not by accident.
    await writeExistingConfig(
      dir,
      `import "@leadtype-test/definitely-not-installed";

export default {
  product: { name: "Acme", tagline: "Acme docs." },
};
`
    );

    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "astro", "--no-generate"],
      capture.io
    );

    // Best-effort by design: an unloadable config fails loudly in generate,
    // so init must not editorialize over what it cannot inspect.
    expect(code).toBe(0);
    expect(capture.stderr).toBe("");
    expect(capture.stdout).toContain("(exists, use --force)");
  });

  it("keeps a full re-scaffold of its own output a quiet no-op", async () => {
    const dir = await createTempDir();
    await runInitCommand(
      ["--dir", dir, "--framework", "astro", "--no-generate"],
      createCapture().io
    );

    // Whichever way the load goes — the scaffolded config imports "leadtype",
    // which may not resolve in the temp project — the rerun is quiet: an
    // unloadable config is tolerated, and a loadable one declares baseUrl.
    const second = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "astro", "--no-generate"],
      second.io
    );

    expect(code).toBe(0);
    expect(second.stderr).toBe("");
    expect(second.stdout).toContain("(exists, use --force)");
  });

  it("refuses --base-url when a root leadtype.config.* wins config discovery", async () => {
    const dir = await createTempDir();
    // generate and the runtime read a root config in preference to the
    // docs/docs.config.ts init writes, so the flag's value would never be
    // read — with or without --force.
    const rootPath = path.join(dir, "leadtype.config.ts");
    await writeFile(
      rootPath,
      `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};
`,
      "utf8"
    );

    for (const extra of [[], ["--force"]]) {
      const capture = createCapture();
      const code = await runInitCommand(
        [
          "--dir",
          dir,
          "--framework",
          "next",
          "--base-url",
          "https://production.example",
          "--no-generate",
          ...extra,
        ],
        capture.io
      );

      expect(code).toBe(2);
      expect(capture.stderr).toContain("leadtype.config.ts takes precedence");
      expect(capture.stderr).toContain("Set baseUrl in leadtype.config.ts");
      expect(existsSync(path.join(dir, "docs/docs.config.ts"))).toBe(false);
    }
  });

  it("notes against the root config when it wins and omits baseUrl", async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, "leadtype.config.ts"),
      `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};
`,
      "utf8"
    );

    const capture = createCapture();
    const code = await runInitCommand(
      ["--dir", dir, "--framework", "astro", "--no-generate"],
      capture.io
    );

    // The message must name the file the loader actually reads — telling the
    // user to edit docs/docs.config.ts would send the value somewhere
    // generate never looks.
    expect(code).toBe(0);
    expect(capture.stderr).toContain("leadtype.config.ts does not set baseUrl");
    expect(capture.stderr).toContain("set baseUrl in leadtype.config.ts");
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
    // baseUrl lives in the scaffolded config now, not in every command.
    expect(pkg.scripts["docs:generate"]).not.toContain("--base-url");

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
