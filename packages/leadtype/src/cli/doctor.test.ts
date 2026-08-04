import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeSyncManifest } from "../sync/sync";
import { type DoctorReport, parseDoctorArgs, runDoctorCommand } from "./doctor";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function createCapture() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: {
        write: (chunk: string) => {
          stdout += chunk;
          return true;
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
          return true;
        },
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-doctor-"));
  tempDirs.push(dir);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
  return dir;
}

function page(title: string): string {
  return `---\ntitle: "${title}"\ndescription: "About ${title}."\n---\n\nBody.\n`;
}

async function runJson(
  srcDir: string,
  extra: string[] = []
): Promise<{ code: number; report: DoctorReport; stdout: string }> {
  const capture = createCapture();
  const code = await runDoctorCommand(
    ["--src", srcDir, "--json", ...extra],
    capture.io
  );
  return {
    code,
    report: JSON.parse(capture.stdout) as DoctorReport,
    stdout: capture.stdout,
  };
}

describe("parseDoctorArgs", () => {
  it("defaults to the current directory and public output", () => {
    expect(parseDoctorArgs([])).toEqual({
      srcDir: ".",
      docsDirs: [],
      outDir: "public",
      json: false,
      help: false,
    });
  });

  it("rejects an unknown option", () => {
    expect(() => parseDoctorArgs(["--nope"])).toThrow(/unknown option/);
  });
});

describe("a healthy local project", () => {
  async function healthy(): Promise<string> {
    return await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: ["index", { title: "Guides", base: "guides", pages: ["auth"] }],
};`,
      "docs/index.mdx": page("Home"),
      "docs/guides/auth.mdx": page("Auth"),
    });
  }

  it("exits 0 and explains config, collections, and navigation", async () => {
    const { code, report } = await runJson(await healthy());

    expect(code).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.config.mode).toBe("single-source");
    expect(report.config.path).toMatch(/docs\.config\.ts$/);
    expect(report.collections[0]).toMatchObject({
      key: "docs",
      routePrefix: "/docs",
      pageCount: 2,
    });
    expect(report.navigation).toMatchObject({
      origin: "explicit",
      groups: ["Guides"],
      routedPages: 2,
    });
  });

  it("reports where each value came from", async () => {
    const { report } = await runJson(await healthy());
    expect(report.config.provenance.navigation).toMatchObject({
      origin: "explicit",
    });
    expect(report.collections[0].provenance).toMatchObject({
      navigation: { origin: "explicit" },
    });
  });

  it("says navigation was derived when nothing was authored", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  openapi: undefined,
  navigation: [],
};`,
      "docs/index.mdx": page("Home"),
      "docs/guides/auth.mdx": page("Auth"),
    });

    const { report } = await runJson(dir);
    expect(report.navigation?.origin).toBe("inferred");
    expect(report.navigation?.groups).toEqual(["Guides"]);
  });

  it("writes nothing — the project is byte-identical afterwards", async () => {
    const dir = await healthy();
    const before = (await readdir(dir, { recursive: true })).sort();

    await runJson(dir);

    expect((await readdir(dir, { recursive: true })).sort()).toEqual(before);
  });

  it("prints a concise human report by default", async () => {
    const capture = createCapture();
    const code = await runDoctorCommand(["--src", await healthy()], capture.io);

    expect(code).toBe(0);
    expect(capture.stdout).toContain("Config");
    expect(capture.stdout).toContain("Collections");
    expect(capture.stdout).toContain("Navigation");
    expect(capture.stdout).toContain("Integrations");
  });
});

describe("findings", () => {
  it("reports a missing config as a warning with the command that fixes it", async () => {
    const { code, report } = await runJson(await fixture({ "readme.md": "" }));

    expect(code).toBe(0);
    const issue = report.issues.find((entry) => entry.id === "config.missing");
    expect(issue?.level).toBe("warn");
    expect(issue?.fix).toBe("leadtype init");
  });

  it("reports an unloadable config as an error and stops there", async () => {
    const dir = await fixture({
      "leadtype.config.ts": "export default { product: {} };",
    });

    const { code, report } = await runJson(dir);

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.issues.map((entry) => entry.id)).toEqual(["config.invalid"]);
  });

  it("names deprecated fields and their replacements", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: { docs: { dir: "docs", prefix: "/docs" } },
};`,
      "docs/index.mdx": page("Home"),
    });

    const { report } = await runJson(dir);
    expect(report.config.deprecations).toEqual([
      {
        field: "collections.docs.prefix",
        replacement: "collections.docs.routePrefix",
      },
    ]);
    expect(
      report.issues.find((entry) => entry.id === "config.deprecated-field")?.fix
    ).toContain("routePrefix");
  });

  it("errors when a remote collection has not been synced, and never clones", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: {
      repository: "https://github.com/acme/acme.git",
      ref: "main",
      cacheDir: ".leadtype/acme",
      dir: "docs",
      routePrefix: "/docs",
    },
  },
};`,
    });

    const { code, report } = await runJson(dir);

    expect(code).toBe(1);
    const issue = report.issues.find(
      (entry) => entry.id === "source.not-synced"
    );
    expect(issue?.level).toBe("error");
    expect(issue?.fix).toBe("leadtype sync");
    // Read-only: no checkout appeared.
    expect(await readdir(dir)).not.toContain(".leadtype");
  });

  it("errors when the cache holds a different revision than the config asks for", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: {
      repository: "https://github.com/acme/acme.git",
      ref: "main",
      cacheDir: ".leadtype/acme",
      dir: "docs",
      routePrefix: "/docs",
    },
  },
};`,
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/other\n",
      ".leadtype/acme/docs/index.mdx": page("Stale"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/acme"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "v0.9",
      commit: "abc1234",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });

    const { code, report } = await runJson(dir);

    expect(code).toBe(1);
    expect(
      report.issues.find((entry) => entry.id === "source.cache-stale")?.fix
    ).toBe("leadtype sync --refresh");
  });

  it("reports the cache path sync actually uses", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: {
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      dir: "docs",
      routePrefix: "/docs",
    },
  },
};`,
      // The path `defaultCacheDir` derives, via repositorySlug.
      ".leadtype/sources/acme-acme@abcdef1234567/.git/HEAD":
        "ref: refs/heads/main\n",
      ".leadtype/sources/acme-acme@abcdef1234567/docs/index.mdx": page("Home"),
    });
    await writeSyncManifest(
      path.join(dir, ".leadtype/sources/acme-acme@abcdef1234567"),
      {
        version: 1,
        repository: "https://github.com/acme/acme.git",
        ref: "abcdef1234567",
        commit: "abcdef1",
        syncedAt: "2026-01-01T00:00:00.000Z",
      }
    );

    const { report } = await runJson(dir);

    // Hand-joining the raw URL produced a path that can never exist, so the
    // Sources table said "not synced" while Findings reported nothing wrong —
    // one report contradicting itself.
    expect(report.sources[0].cacheDir).toContain("acme-acme@abcdef1234567");
    expect(report.sources[0].syncedCommit).toBe("abcdef1");
    expect(
      report.issues.find((entry) => entry.id === "source.not-synced")
    ).toBeUndefined();
  });

  it("warns about a mutable ref and points at the collection that set it", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: {
      repository: "https://github.com/acme/acme.git",
      ref: "main",
      cacheDir: ".leadtype/acme",
      dir: "docs",
      routePrefix: "/docs",
    },
  },
};`,
    });

    const { report } = await runJson(dir);
    const issue = report.issues.find(
      (entry) => entry.id === "source.mutable-ref"
    );
    expect(issue?.level).toBe("warn");
    expect(issue?.owner).toBe("collections.docs.ref");
  });

  it("reports one acquisition shared by several collections", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: {
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      cacheDir: ".leadtype/acme",
      dir: "docs",
      routePrefix: "/docs",
    },
    changelog: {
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      cacheDir: ".leadtype/acme",
      dir: "changelog",
      routePrefix: "/changelog",
    },
  },
};`,
    });

    const { report } = await runJson(dir);
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0].collections).toEqual(["docs", "changelog"]);
    expect(
      report.issues.find((entry) => entry.id === "source.shared-acquisition")
        ?.level
    ).toBe("info");
  });

  it("warns when a page is absent from navigation", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: ["index"],
};`,
      "docs/index.mdx": page("Home"),
      "docs/orphan.mdx": page("Orphan"),
    });

    const { code, report } = await runJson(dir);

    expect(code).toBe(0);
    expect(report.navigation?.unrepresentedPages).toEqual(["/docs/orphan"]);
    expect(
      report.issues.find((entry) => entry.id === "nav.unrepresented-page")
        ?.level
    ).toBe("warn");
  });

  it("warns when a collection's include globs match nothing", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "docs", routePrefix: "/docs", include: ["nothing/**/*.mdx"] },
  },
};`,
      "docs/index.mdx": page("Home"),
    });

    const { report } = await runJson(dir);
    const issue = report.issues.find(
      (entry) => entry.id === "collection.no-matches"
    );
    expect(issue?.level).toBe("warn");
    expect(issue?.owner).toBe("collections.docs.include");
  });

  it("reports missing and stale artifacts against the output root", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: ["index"],
};`,
      "docs/index.mdx": page("Home"),
      "public/llms.txt": "# Acme\n",
    });

    // `--out` resolves against cwd, matching `leadtype generate` — the two
    // commands must read the same flags the same way.
    const { report } = await runJson(dir, ["--out", path.join(dir, "public")]);
    expect(report.outputs.present).toEqual(["llms.txt"]);
    expect(report.outputs.missing.length).toBeGreaterThan(0);
    expect(
      report.issues.find((entry) => entry.id === "output.missing-artifacts")
        ?.fix
    ).toBe("leadtype generate");
  });
});

describe("source-owned inheritance", () => {
  const config = `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: {
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      cacheDir: ".leadtype/acme",
      dir: "docs",
      routePrefix: "/docs",
      inheritConfig: true,
    },
  },
};`;

  async function syncedFixture(): Promise<string> {
    const dir = await fixture({
      "leadtype.config.ts": config,
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/main\n",
      ".leadtype/acme/docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: [{ title: "Guides", base: "guides", pages: ["auth"] }],
};`,
      ".leadtype/acme/docs/guides/auth.mdx": page("Auth"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/acme"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      commit: "abcdef1",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });
    return dir;
  }

  it("reports the navigation the source repo owns, not an inferred one", async () => {
    const { report } = await runJson(await syncedFixture());

    // Without applying inheritance doctor would call this "inferred" and show
    // a filesystem-derived tree — for a pinned-source project that is exactly
    // the question doctor exists to answer, answered wrongly.
    expect(report.navigation?.origin).toBe("inherited");
    expect(report.navigation?.groups).toEqual(["Guides"]);
  });

  it("fails, but still reports, when the source config cannot be read", async () => {
    const dir = await fixture({
      "leadtype.config.ts": config,
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/main\n",
      ".leadtype/acme/docs/index.mdx": page("Home"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/acme"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      commit: "abcdef1",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });

    const { code, report } = await runJson(dir);

    // `inheritConfig` is opt-in, and `generate` throws on a source whose config
    // can't be read — so exiting 0 here would let CI pass a project the build
    // then fails on. Read-only still means reporting rather than throwing.
    expect(code).toBe(1);
    expect(
      report.issues.find((entry) => entry.id === "source.inherit-failed")?.level
    ).toBe("error");
    expect(report.navigation).not.toBeNull();
  });

  it("keeps other collections readable when one source is unreadable", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    good: { dir: "content/good", routePrefix: "/good" },
    bad: {
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      cacheDir: ".leadtype/bad",
      dir: "docs",
      routePrefix: "/bad",
      inheritConfig: true,
    },
  },
};`,
      "content/good/index.mdx": page("Good"),
      ".leadtype/bad/.git/HEAD": "ref: refs/heads/main\n",
      ".leadtype/bad/docs/index.mdx": page("Bad"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/bad"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      commit: "abcdef1",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });

    const { report } = await runJson(dir);

    // Inheritance used to run for the whole map in one call, so the first
    // unreadable source discarded every other collection's inherited config.
    expect(
      report.issues.filter((entry) => entry.id === "source.inherit-failed")
    ).toHaveLength(1);
    expect(report.collections.map((entry) => entry.key)).toEqual([
      "good",
      "bad",
    ]);
    expect(
      report.collections.find((entry) => entry.key === "good")?.pageCount
    ).toBe(1);
  });
});

describe("integrations", () => {
  it("names the detected framework and enabled agent surfaces", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({
        name: "acme-docs",
        dependencies: { next: "^15.0.0" },
      }),
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: ["index"],
  agents: { mcp: { enabled: true }, robots: { policy: "balanced" } },
};`,
      "docs/index.mdx": page("Home"),
    });

    const { report } = await runJson(dir);
    expect(report.integrations.framework).toBe("Next.js");
    expect(report.integrations.surfaces).toContain("mcp");
    expect(report.integrations.surfaces).toContain("robots:balanced");
  });
});
