import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { writeSyncManifest } from "../sync/sync";
import { resolveProject } from "./project";

// Fixture configs import from source so they exercise the working tree.
const LEADTYPE_ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-resolve-"));
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

const IDENTITY = 'product: { name: "Acme", tagline: "Acme docs." }';

describe("discovery", () => {
  it("reports a missing config as a diagnostic, not a throw", async () => {
    const project = await resolveProject({
      cwd: await fixture({ "readme.md": "" }),
    });

    expect(project.config).toBeNull();
    expect(project.diagnostics.map((entry) => entry.id)).toEqual([
      "config.missing",
    ]);
  });

  it("throws only when the config itself is malformed", async () => {
    const dir = await fixture({
      "leadtype.config.ts": "export default { product: {} };",
    });
    await expect(resolveProject({ cwd: dir })).rejects.toThrow();
  });

  it("takes a caller-supplied config instead of discovering one", async () => {
    const dir = await fixture({ "docs/index.mdx": page("Home") });

    const project = await resolveProject({
      cwd: dir,
      config: {
        product: { name: "Acme", tagline: "Acme docs." },
        navigation: ["index"],
      },
    });

    expect(project.collections[0]?.navigationOrigin).toBe("explicit");
    expect(project.collections[0]?.contentDir).toBe(path.join(dir, "docs"));
  });

  it("puts the content root beside a docs.config, and below a leadtype.config", async () => {
    const sourceOwned = await fixture({
      "docs/docs.config.ts": `export default { ${IDENTITY} };`,
      "docs/index.mdx": page("Home"),
    });
    const projectOwned = await fixture({
      "leadtype.config.ts": `export default { ${IDENTITY} };`,
      "docs/index.mdx": page("Home"),
    });

    // Same rule the CLI's discovery uses: a `docs.config.*` lives inside the
    // docs directory, a `leadtype.config.*` sits at the root above it.
    expect(
      (await resolveProject({ cwd: sourceOwned })).collections[0]?.contentDir
    ).toBe(path.join(sourceOwned, "docs"));
    expect(
      (await resolveProject({ cwd: projectOwned })).collections[0]?.contentDir
    ).toBe(path.join(projectOwned, "docs"));
  });

  it("derives the project root from an explicit configPath's basename", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default { ${IDENTITY}, navigation: ["index"] };`,
      "docs/index.mdx": page("Home"),
    });

    // A `docs.config.*` lives inside the docs directory, so its content root
    // is its own directory — not `<dir>/docs/docs`, which is what deriving the
    // root as `dirname(configPath)` produces.
    const project = await resolveProject({
      configPath: path.join(dir, "docs", "docs.config.ts"),
    });

    expect(project.collections[0]?.contentDir).toBe(path.join(dir, "docs"));
    expect(project.collections[0]?.navigationOrigin).toBe("explicit");
  });
});

describe("navigation origin", () => {
  it("reports an authored tree as explicit", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default { ${IDENTITY}, navigation: ["index"] };`,
      "docs/index.mdx": page("Home"),
    });
    const project = await resolveProject({ cwd: dir });
    expect(project.collections[0]?.navigationOrigin).toBe("explicit");
  });

  it("derives from the content tree when nothing was authored", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default { ${IDENTITY} };`,
      "docs/index.mdx": page("Home"),
      "docs/guides/auth.mdx": page("Auth"),
    });
    const project = await resolveProject({ cwd: dir });

    expect(project.collections[0]?.navigationOrigin).toBe("inferred");
    expect(project.collections[0]?.navigation).toBeDefined();
    expect(project.inference.values.map((entry) => entry.field)).toContain(
      "navigation"
    );
  });

  it("does not derive over a localized tree", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default { ${IDENTITY}, i18n: { defaultLocale: "en", locales: ["en", "fr"] } };`,
      "docs/en/index.mdx": page("Home"),
      "docs/en/guides/auth.mdx": page("Auth"),
    });
    const project = await resolveProject({ cwd: dir });

    // Derivation keys sections off the first path segment — the locale, for a
    // localized tree — so nav/doctor would print a locale-keyed tree the real
    // build never produces. `generate` skips derivation for i18n projects.
    expect(project.collections[0]?.navigationOrigin).toBe("inferred");
    expect(project.collections[0]?.navigation).toBeUndefined();
    expect(project.inference.values.map((entry) => entry.field)).not.toContain(
      "navigation"
    );
  });

  it("can be told not to infer", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default { ${IDENTITY} };`,
      "docs/index.mdx": page("Home"),
    });
    const project = await resolveProject({ cwd: dir, infer: false });
    expect(project.collections[0]?.navigation).toBeUndefined();
  });

  it("falls back to groups when they are the only taxonomy", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default { ${IDENTITY}, groups: [{ slug: "start", title: "Start" }] };`,
      "docs/index.mdx": "---\ntitle: Home\ngroup: start\n---\n\nBody.\n",
    });
    const project = await resolveProject({ cwd: dir });
    expect(project.collections[0]?.navigationOrigin).toBe("groups");
  });
});

describe("pinned remote sources", () => {
  const config = `export default {
  ${IDENTITY},
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

  async function synced(): Promise<string> {
    const dir = await fixture({
      "leadtype.config.ts": config,
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/main\n",
      ".leadtype/acme/docs/docs.config.ts": `export default {
  ${IDENTITY},
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

  it("resolves a remote dir against its checkout, not the config directory", async () => {
    const dir = await synced();
    const project = await resolveProject({ cwd: dir });

    // The single most repeated bug in the commands this replaces: resolving
    // `dir` against the config directory finds nothing and every page vanishes.
    expect(project.collections[0]?.contentDir).toBe(
      path.join(dir, ".leadtype/acme/docs")
    );
  });

  it("applies source-owned inheritance, so the tree is the source repo's", async () => {
    const project = await resolveProject({ cwd: await synced() });

    // The other repeated bug: without inheritance this reports "inferred" and
    // a filesystem-derived tree the real build never uses.
    expect(project.collections[0]?.navigationOrigin).toBe("inherited");
    expect(project.collections[0]?.navigation).toEqual([
      { title: "Guides", base: "guides", pages: ["auth"] },
    ]);
  });

  it("can be told not to inherit", async () => {
    const project = await resolveProject({
      cwd: await synced(),
      inherit: false,
    });
    expect(project.collections[0]?.navigationOrigin).not.toBe("inherited");
  });

  it("reports an unsynced source without cloning", async () => {
    const dir = await fixture({ "leadtype.config.ts": config });
    const project = await resolveProject({ cwd: dir });

    const diagnostic = project.diagnostics.find(
      (entry) => entry.id === "source.not-synced"
    );
    expect(diagnostic?.level).toBe("error");
    expect(diagnostic?.fix).toBe("leadtype sync");
    expect(project.collections[0]?.contentDir).toBeUndefined();
  });

  it("rejects a cache checked out with fewer paths than configured", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  ${IDENTITY},
  collections: {
    docs: {
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      cacheDir: ".leadtype/acme",
      dir: "docs",
      routePrefix: "/docs",
      sparse: ["docs", "packages"],
    },
  },
};`,
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/main\n",
      ".leadtype/acme/docs/index.mdx": page("Home"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/acme"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      commit: "abcdef1",
      syncedAt: "2026-01-01T00:00:00.000Z",
      // Synced before `packages` was added to the config.
      sparse: ["docs"],
    });

    const project = await resolveProject({ cwd: dir });

    // Everything the older checks looked at passes: .git exists, the manifest
    // parses, repository and ref match, and `dir` is present. The only symptom
    // would be `<AutoTypeTable>` silently resolving to nothing.
    const diagnostic = project.diagnostics.find(
      (entry) => entry.id === "source.cache-narrow"
    );
    expect(diagnostic?.level).toBe("error");
    expect(diagnostic?.fix).toBe("leadtype sync --refresh");
    expect(diagnostic?.message).toContain("[docs]");
    expect(diagnostic?.message).toContain("[docs, packages]");
  });

  it("accepts a fully-cloned cache when the config asks for sparse paths", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  ${IDENTITY},
  collections: {
    docs: {
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      cacheDir: ".leadtype/acme",
      dir: "docs",
      routePrefix: "/docs",
      sparse: ["docs", "packages"],
    },
  },
};`,
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/main\n",
      ".leadtype/acme/docs/index.mdx": page("Home"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/acme"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      commit: "abcdef1",
      syncedAt: "2026-01-01T00:00:00.000Z",
      // Cloned in full, before `sparse` entered the config. Every configured
      // path is present — a superset, not a narrow checkout.
    });

    const project = await resolveProject({ cwd: dir });

    expect(
      project.diagnostics.find((entry) => entry.id === "source.cache-narrow")
    ).toBeUndefined();
    expect(project.collections[0]?.contentDir).toBe(
      path.join(dir, ".leadtype/acme/docs")
    );
  });

  it("reports a cache holding the wrong revision", async () => {
    const dir = await fixture({
      "leadtype.config.ts": config,
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

    const project = await resolveProject({ cwd: dir });
    expect(
      project.diagnostics.find((entry) => entry.id === "source.cache-stale")
        ?.level
    ).toBe("error");
  });
});

describe("the acquisition graph", () => {
  it("keeps authored source names through inheritance", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `import { gitSource } from "LEADTYPE_ENTRY";

export default {
  ${IDENTITY},
  sources: {
    upstream: gitSource({
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      cacheDir: ".leadtype/acme",
      collections: { docs: { dir: "docs", routePrefix: "/docs", inheritConfig: true } },
    }),
  },
};`.replace("LEADTYPE_ENTRY", LEADTYPE_ENTRY),
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/main\n",
      ".leadtype/acme/docs/docs.config.ts": `export default { ${IDENTITY}, navigation: ["index"] };`,
      ".leadtype/acme/docs/index.mdx": page("Home"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/acme"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      commit: "abcdef1",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });

    const project = await resolveProject({ cwd: dir });

    // Normalization expands `sources` into `collections`, so only the first
    // pass ever sees the authored names. Re-deriving after inheritance would
    // report the graph as `repo#ref` and lose "upstream" everywhere it shows:
    // sync output, doctor, and --json.
    expect(project.sources.map((entry) => entry.id)).toEqual(["upstream"]);
    expect(project.collections[0]?.sourceId).toBe("upstream");
    expect(project.collections[0]?.navigationOrigin).toBe("inherited");
  });
});

describe("deprecations", () => {
  it("survives the re-normalization that inheritance requires", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  ${IDENTITY},
  collections: { docs: { dir: "content", prefix: "/docs" } },
};`,
      "content/index.mdx": page("Home"),
    });

    const project = await resolveProject({ cwd: dir });

    // Aliases are folded during load, so a second normalization pass finds
    // none — reporting none would tell a legacy config it has nothing to fix.
    expect(project.resolved?.deprecations).toEqual([
      {
        id: "collection.prefix",
        field: "collections.docs.prefix",
        replacement: "collections.docs.routePrefix",
        message: expect.stringContaining("routePrefix"),
      },
    ]);
  });
});
