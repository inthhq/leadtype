import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("reports an unresolvable navigation as a finding, not a crash", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: [
    { title: "Guides", base: "guides", pages: [{ include: "**", pin: ["renamed"] }] },
  ],
};`,
      "docs/guides/setup.mdx": page("Setup"),
    });

    // CI gates on doctor: a pin typo has to come back as a report with a
    // stable id, not a raw error under `--json` with no report at all.
    // `runJson` parses stdout, so this also asserts the JSON stayed valid.
    const { code, report } = await runJson(dir);

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    const finding = report.issues.find(
      (entry) => entry.id === "nav.unresolvable"
    );
    expect(finding?.level).toBe("error");
    expect(finding?.message).toContain('Nav pin "renamed"');
    expect(finding?.owner).toBe("navigation");
    expect(finding?.fix).toContain("leadtype doctor");
  });

  it("reports curated navigation naming an excluded page as a finding", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "docs", routePrefix: "/docs", exclude: ["drafts/**"], navigation: ["index", "drafts/wip"] },
  },
};`,
      "docs/index.mdx": page("Home"),
      "docs/drafts/wip.mdx": page("WIP"),
    });

    // `generate` stages the filtered mirror before resolving, so this
    // reference fails the build as missing. Resolving against the raw
    // directory let it succeed here, and the admitted-page check merely
    // dropped the page from counts — `ok: true` for a build that exits 1.
    const { code, report } = await runJson(dir);

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    const finding = report.issues.find(
      (entry) => entry.id === "nav.unresolvable"
    );
    expect(finding?.level).toBe("error");
    expect(finding?.message).toContain('Nav page "drafts/wip"');
    expect(finding?.owner).toBe("collections.docs.navigation");
    expect(finding?.fix).toContain("include");
  });

  it("reports a non-default locale's unknown group when the default locale is clean", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  i18n: { defaultLocale: "en", locales: ["en", "zh"] },
  groups: [{ slug: "guides", title: "Guides" }],
};`,
      "docs/index.mdx": `---\ntitle: "Home"\ngroup: guides\n---\n\nBody.\n`,
      "docs/zh/index.mdx": `---\ntitle: "Home (zh)"\ngroup: mystery\n---\n\nBody.\n`,
    });

    // `generate` resolves the tree once per configured locale and exits 1 on
    // '/docs/zh declares unknown group "mystery"'. Resolving only the
    // default locale missed the translation's finding entirely — doctor said
    // ok for a build that fails.
    const { code, report } = await runJson(dir);

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    const finding = report.issues.find(
      (entry) => entry.id === "nav.unknown-group"
    );
    expect(finding?.level).toBe("error");
    expect(finding?.message).toBe('/docs/zh declares unknown group "mystery"');
  });

  it("keeps excluded pages out of the routed page count", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "docs", routePrefix: "/docs", exclude: ["drafts/**"], navigation: ["index"] },
  },
};`,
      "docs/index.mdx": page("Home"),
      "docs/drafts/wip.mdx": page("WIP"),
    });

    const { report } = await runJson(dir);

    // `generate` stages a filtered mirror before resolving navigation, so an
    // excluded page never routes — counting it here disagreed with the
    // collection's own page count on the same report.
    expect(report.collections[0]?.pageCount).toBe(1);
    expect(report.navigation?.routedPages).toBe(1);
  });

  it("lists each declared group once, however many collections read it", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "content/docs", routePrefix: "/docs", groups: [{ slug: "ref", title: "Reference" }] },
    guides: { dir: "content/guides", routePrefix: "/guides", groups: [{ slug: "howto", title: "How-to" }] },
  },
};`,
      "content/docs/api.mdx": `---\ntitle: "API"\ndescription: "API."\ngroup: ref\n---\n\nBody.\n`,
      "content/guides/deploy.mdx": `---\ntitle: "Deploy"\ndescription: "Deploy."\ngroup: howto\n---\n\nBody.\n`,
    });

    const { report } = await runJson(dir);

    // Groups merge across collections (membership is pure slug matching), and
    // each collection's manifest emits every declared group — so without a
    // dedupe two collections sharing two groups read `sections: Reference,
    // How-to, Reference, How-to`.
    expect(report.navigation?.groups).toEqual(["Reference", "How-to"]);
  });

  it("reports mixed navigation origins instead of collapsing them to explicit", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "content/docs", routePrefix: "/docs", navigation: ["index"] },
    changelog: { dir: "content/changelog", routePrefix: "/changelog" },
  },
};`,
      "content/docs/index.mdx": page("Home"),
      "content/changelog/1-0.mdx": page("1.0"),
    });

    const { report } = await runJson(dir);

    expect(report.navigation?.origin).toBe("mixed");
    expect(
      report.collections.map((entry) => [entry.key, entry.navigationOrigin])
    ).toEqual([
      ["docs", "explicit"],
      ["changelog", "inferred"],
    ]);
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

describe("config load warnings", () => {
  it("warns about unknown config keys with a did-you-mean", async () => {
    const dir = await fixture({
      // Typos at the two levels that bite hardest in an untyped config: a
      // misspelled top-level `navigation` silently reverts the tree to
      // inferred, and a misspelled `routePrefix` silently keeps the default.
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigatoin: ["index"],
  collections: {
    docs: { dir: "docs", routePrefx: "/docs" },
  },
};`,
      "docs/index.mdx": page("Home"),
    });

    const { code, report } = await runJson(dir);

    // Forward compatibility: unknown keys warn, never error.
    expect(code).toBe(0);
    const findings = report.issues.filter(
      (entry) => entry.id === "config.unknown-key"
    );
    expect(findings.map((entry) => entry.owner).sort()).toEqual([
      "collections.docs.routePrefx",
      "navigatoin",
    ]);
    expect(findings.every((entry) => entry.level === "warn")).toBe(true);
    expect(
      findings.find((entry) => entry.owner === "navigatoin")?.message
    ).toContain('did you mean "navigation"');
    expect(
      findings.find((entry) => entry.owner === "collections.docs.routePrefx")
        ?.message
    ).toContain('did you mean "routePrefix"');
  });

  it("stays silent for known keys and deliberately open surfaces", async () => {
    const dir = await fixture({
      // `frontmatterSchema` contents, `mounts` entries, and `llms` sections
      // are open by design — extra keys there are the author's vocabulary,
      // not typos of ours.
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  frontmatterSchema: { anyField: { type: "string" }, andAnother: {} },
  mounts: [{ pathPrefix: "", urlPrefix: "/docs", futureOption: true }],
  llms: { sections: [{ kind: "markdown", title: "Notes", body: "Body." }] },
  navigation: ["index"],
};`,
      "docs/index.mdx": page("Home"),
    });

    const { report } = await runJson(dir);

    expect(
      report.issues.filter((entry) => entry.id === "config.unknown-key")
    ).toEqual([]);
  });

  it("routes the deprecation warning through the injected io", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: { docs: { dir: "docs", prefix: "/docs" } },
};`,
      "docs/index.mdx": page("Home"),
    });

    // The load-time warning used to go through the process-wide logger, which
    // doctor's injected io never sees — it leaked into test output while the
    // `--json` stdout stayed clean.
    const realStderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const capture = createCapture();
      const code = await runDoctorCommand(["--src", dir, "--json"], capture.io);

      expect(code).toBe(0);
      expect(capture.stderr).toContain("deprecated");
      // Structured output stays parseable — warnings never interleave.
      expect(() => JSON.parse(capture.stdout)).not.toThrow();
      expect(realStderr).not.toHaveBeenCalled();
    } finally {
      realStderr.mockRestore();
    }
  });
});

describe("--docs-dir", () => {
  it("honors every value, matching generate's legacy multi-dir shape", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};`,
      "docs/index.mdx": page("Home"),
      "guides/setup.mdx": page("Setup"),
    });

    const { code, report } = await runJson(dir, [
      "--docs-dir",
      "docs",
      "--docs-dir",
      "guides",
    ]);

    // `generate` stages the first directory at the docs root and each further
    // one under its folder name; reading only `docsDirs[0]` reported a
    // project missing every page the build actually ships.
    expect(code).toBe(0);
    expect(
      report.collections.map((entry) => [
        entry.key,
        entry.routePrefix,
        entry.pageCount,
      ])
    ).toEqual([
      ["docs", "/docs", 1],
      ["guides", "/docs/guides", 1],
    ]);
    expect(report.navigation?.routedPages).toBe(2);
  });

  it("parses the documented <dir>=<url-prefix> form as generate does", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};`,
      "docs/index.mdx": page("Home"),
      "changelog/v1.mdx": page("V1"),
    });

    // Verbatim from docs/reference/cli.mdx — the raw value used to be
    // resolved whole as a path, so `<root>/changelog=/changelog` reported
    // `source.dir-missing` and doctor exited 1 on a project generate builds.
    const { code, report } = await runJson(dir, [
      "--docs-dir",
      "docs",
      "--docs-dir",
      "changelog=/changelog",
    ]);

    expect(code).toBe(0);
    expect(
      report.collections.map((entry) => [entry.key, entry.routePrefix])
    ).toEqual([
      ["docs", "/docs"],
      ["changelog", "/changelog"],
    ]);
    expect(report.collections[1]?.provenance).toMatchObject({
      routePrefix: {
        origin: "default",
        inferredFrom: "url prefix (--docs-dir)",
      },
    });
  });

  it("applies the first value's <dir>=<url-prefix> to the primary collection", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};`,
      "docs/index.mdx": page("Home"),
    });

    // `generate` applies an explicit prefix to every parsed value, including
    // the first; skipping index 0 reported the primary collection at the
    // normalized default `/docs` while the build serves it at `/manual`.
    const { code, report } = await runJson(dir, ["--docs-dir", "docs=/manual"]);

    expect(code).toBe(0);
    expect(
      report.collections.map((entry) => [entry.key, entry.routePrefix])
    ).toEqual([["docs", "/manual"]]);
    // The prefix came from a flag, not the config file — `explicit` is
    // documented as config-authored, so provenance points at `--docs-dir`
    // the same way the sibling `dir` field does.
    expect(report.collections[0]?.provenance).toMatchObject({
      routePrefix: {
        origin: "default",
        inferredFrom: "url prefix (--docs-dir)",
      },
    });
  });

  it("resolves every value when the project has no config, as generate stages them", async () => {
    const dir = await fixture({
      "docs/index.mdx": page("Home"),
      "changelog/v1.mdx": page("V1"),
    });

    const { code, report } = await runJson(dir, [
      "--docs-dir",
      "docs",
      "--docs-dir",
      "changelog",
    ]);

    // A missing config stays a warning, but the report covers the project
    // `generate` builds — returning an empty project here reported no
    // collections, routes, or pages and still exited 0.
    expect(code).toBe(0);
    expect(
      report.issues.find((entry) => entry.id === "config.missing")?.level
    ).toBe("warn");
    expect(
      report.collections.map((entry) => [
        entry.key,
        entry.routePrefix,
        entry.pageCount,
      ])
    ).toEqual([
      ["docs", "/docs", 1],
      ["changelog", "/docs/changelog", 1],
    ]);
    expect(report.navigation?.routedPages).toBe(2);
  });

  it("rejects a malformed value with generate's message", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};`,
      "docs/index.mdx": page("Home"),
    });

    const { code, report } = await runJson(dir, [
      "--docs-dir",
      "docs",
      "--docs-dir",
      "changelog=",
    ]);

    expect(code).toBe(1);
    const issue = report.issues.find((entry) => entry.id === "config.invalid");
    expect(issue?.message).toContain('Invalid --docs-dir value "changelog="');
  });

  it("rejects values colliding on a mount path, with generate's message", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};`,
      "docs/index.mdx": page("Home"),
      "a/guides/one.mdx": page("One"),
      "b/guides/two.mdx": page("Two"),
    });

    const { code, report } = await runJson(dir, [
      "--docs-dir",
      "docs",
      "--docs-dir",
      "a/guides",
      "--docs-dir",
      "b/guides",
    ]);

    expect(code).toBe(1);
    const issue = report.issues.find((entry) => entry.id === "config.invalid");
    expect(issue?.message).toContain('same mount path "guides"');
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
