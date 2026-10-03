import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeSyncManifest } from "../sync/sync";
import { resolveProjectNavigation } from "./navigation";
import { resolveProject } from "./project";

// Fixture configs import from source so they exercise the working tree.
// A file URL is a valid ESM specifier; a Windows path is not — `\a` and
// `\t` in `D:\a\leadtype\...` are escape sequences inside the generated
// `import` string.
const LEADTYPE_ENTRY = new URL("../index.ts", import.meta.url).href;

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

  it("resolves --docs-dir collections without a config, matching generate", async () => {
    const dir = await fixture({
      "docs/index.mdx": page("Home"),
      "changelog/v1.mdx": page("V1"),
    });

    const project = await resolveProject({
      cwd: dir,
      docsDirs: ["docs=/manual", "changelog"],
    });

    // No config is a supported `generate` fallback: it stages every
    // `--docs-dir`, the first at its explicit prefix. Reporting an empty
    // project here made doctor and nav disagree with the build.
    expect(project.config).toBeNull();
    expect(project.diagnostics.map((entry) => entry.id)).toEqual([
      "config.missing",
    ]);
    expect(
      project.collections.map((entry) => [
        entry.key,
        entry.routePrefix,
        entry.contentDir,
      ])
    ).toEqual([
      ["docs", "/manual", path.join(dir, "docs")],
      ["changelog", "/docs/changelog", path.join(dir, "changelog")],
    ]);
    expect(project.sources).toEqual([
      { id: "local", kind: "local", collectionKeys: ["docs", "changelog"] },
    ]);
    // Flag-supplied prefixes are attributed to `--docs-dir`, not reported as
    // config-authored — there is no config file here to hunt through.
    expect(project.collections[0]?.provenance.routePrefix).toEqual({
      origin: "default",
      inferredFrom: "url prefix (--docs-dir)",
    });
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

  it("represents an in-memory config honestly — no fabricated path", async () => {
    const dir = await fixture({ "docs/index.mdx": page("Home") });

    const project = await resolveProject({
      cwd: dir,
      config: {
        product: { name: "Acme", tagline: "Acme docs." },
        navigation: ["index"],
      },
    });

    // The old behavior stamped `<root>/leadtype.config.ts` on a config that
    // never came from a file, so doctor-style consumers reported a config
    // path that does not exist.
    expect(project.configPath).toBeUndefined();
    expect(project.configOrigin).toBe("caller");
    expect(project.configDir).toBe(dir);
  });

  it("keeps a caller-named configPath, still marked caller-supplied", async () => {
    const dir = await fixture({ "docs/index.mdx": page("Home") });
    const configPath = path.join(dir, "leadtype.config.ts");

    const project = await resolveProject({
      config: {
        product: { name: "Acme", tagline: "Acme docs." },
        navigation: ["index"],
      },
      configPath,
    });

    expect(project.configPath).toBe(configPath);
    expect(project.configOrigin).toBe("caller");
  });

  it("marks a discovered config as file-origin", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default { ${IDENTITY} };`,
      "docs/index.mdx": page("Home"),
    });

    const project = await resolveProject({ cwd: dir });

    expect(project.configOrigin).toBe("file");
    expect(project.configPath).toBe(path.join(dir, "docs", "docs.config.ts"));
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

  it("derives over the collection's filtered file set", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default { ${IDENTITY}, collections: { docs: { dir: "docs", exclude: ["drafts/**"] } } };`,
      "docs/index.mdx": page("Home"),
      "docs/guides/auth.mdx": page("Auth"),
      "docs/drafts/wip.mdx": page("WIP"),
    });
    const project = await resolveProject({ cwd: dir });

    // `generate` stages a filtered mirror and derives from it, so the
    // derived tree must come from the filtered file set — a section built
    // from excluded drafts would advertise pages no artifact contains.
    expect(project.collections[0]?.navigationOrigin).toBe("inferred");
    const titles = (project.collections[0]?.navigation ?? []).map((entry) =>
      typeof entry === "object" && "title" in entry ? entry.title : entry
    );
    expect(titles).toEqual(["index", "Guides"]);
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

  it("does not import inherited config from a stale cache", async () => {
    const dir = await fixture({
      "leadtype.config.ts": config,
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/other\n",
      ".leadtype/acme/docs/docs.config.ts": `export default {
  ${IDENTITY},
  navigation: [{ title: "Guides", base: "guides", pages: ["auth"] }],
};`,
      ".leadtype/acme/docs/guides/auth.mdx": page("Auth"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/acme"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "v0.9",
      commit: "abc1234",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });

    const project = await resolveProject({ cwd: dir });

    // Inheritance imports the checkout's docs.config.*; a mismatched
    // revision must be rejected before that module runs.
    expect(
      project.diagnostics.find((entry) => entry.id === "source.cache-stale")
        ?.level
    ).toBe("error");
    expect(project.collections[0]?.navigationOrigin).not.toBe("inherited");
    expect(project.collections[0]?.navigation).toBeUndefined();
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

describe("unknown config keys", () => {
  it("surfaces them as warn diagnostics and through the warn sink", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  ${IDENTITY},
  navigatoin: ["index"],
};`,
      "docs/index.mdx": page("Home"),
    });

    const sunk: string[] = [];
    const project = await resolveProject({
      cwd: dir,
      warn: (call) => sunk.push(call.human.message),
    });

    const diagnostic = project.diagnostics.find(
      (entry) => entry.id === "config.unknown-key"
    );
    expect(diagnostic?.level).toBe("warn");
    expect(diagnostic?.owner).toBe("navigatoin");
    expect(diagnostic?.message).toContain('did you mean "navigation"');
    // The tree quietly reverted to inferred — which is exactly why silence
    // here undercuts the provenance story.
    expect(project.collections[0]?.navigationOrigin).toBe("inferred");
    expect(sunk.some((message) => message.includes("navigatoin"))).toBe(true);
  });

  it("suggests the nearest known key, not the first within the bound", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  ${IDENTITY},
  collections: { docs: { dir: "docs", prefx: "/docs" } },
};`,
      "docs/index.mdx": page("Home"),
    });

    const project = await resolveProject({ cwd: dir });

    // "ref" is also within edit distance 2 of "prefx" and listed earlier;
    // a single pass at the full bound suggested it over "prefix".
    const diagnostic = project.diagnostics.find(
      (entry) => entry.id === "config.unknown-key"
    );
    expect(diagnostic?.message).toContain('did you mean "prefix"');
  });

  it("covers inherited source configs, pointing at the source file", async () => {
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
      inheritConfig: true,
    },
  },
};`,
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/main\n",
      // The typo'd key sits in the *source repo's* config: the host config is
      // clean, so the load-time collector sees nothing, and inheritance only
      // extracts the fields it knows — `navigatoin` was silently inert and
      // the collection quietly fell back to an inferred tree.
      ".leadtype/acme/docs/docs.config.ts": `export default {
  ${IDENTITY},
  navigatoin: [{ title: "Guides", base: "guides", pages: ["auth"] }],
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

    const sunk: string[] = [];
    const project = await resolveProject({
      cwd: dir,
      warn: (call) => sunk.push(call.human.message),
    });

    const sourceConfigPath = path.join(
      dir,
      ".leadtype/acme/docs/docs.config.ts"
    );
    const diagnostic = project.diagnostics.find(
      (entry) => entry.id === "config.unknown-key"
    );
    expect(diagnostic?.level).toBe("warn");
    expect(diagnostic?.collection).toBe("docs");
    // The owner names the source config file: a bare `navigatoin` would send
    // users hunting the host config, which does not contain it.
    expect(diagnostic?.owner).toBe(`${sourceConfigPath}#navigatoin`);
    expect(diagnostic?.message).toContain(
      `source config for collection "docs" at "${sourceConfigPath}"`
    );
    expect(diagnostic?.message).toContain('did you mean "navigation"');
    // Nothing was inherited, so the tree fell back to inferred — the failure
    // the warning explains.
    expect(project.collections[0]?.navigationOrigin).toBe("inferred");
    expect(sunk.some((message) => message.includes(sourceConfigPath))).toBe(
      true
    );
  });

  it("re-emits into the same sink when a reload changes the warning set", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  ${IDENTITY},
  navigatoin: ["index"],
};`,
      "docs/index.mdx": page("Home"),
    });
    const configPath = path.join(dir, "leadtype.config.ts");

    // One long-lived sink, like `generate --watch` reloading through the
    // process logger. A path-only dedupe silenced every warning after the
    // first: replace one typo with a different one and nothing printed until
    // the process restarted.
    const sunk: string[] = [];
    const sink = (call: { human: { message: string } }) =>
      sunk.push(call.human.message);
    const unknownKeyMessages = () =>
      sunk.filter((message) => message.includes("unknown config field"));

    await resolveProject({ cwd: dir, warn: sink });
    // Identical reload: stays quiet.
    await resolveProject({ cwd: dir, warn: sink });
    expect(unknownKeyMessages()).toHaveLength(1);
    expect(unknownKeyMessages()[0]).toContain("navigatoin");

    // The watched file changes to a different typo: the warning set changed,
    // so the same sink hears about it again.
    await writeFile(
      configPath,
      `export default {
  ${IDENTITY},
  navigaton: ["index"],
};`,
      "utf8"
    );
    await resolveProject({ cwd: dir, warn: sink });
    expect(unknownKeyMessages()).toHaveLength(2);
    expect(unknownKeyMessages()[1]).toContain("navigaton");

    // And the new set, unchanged, is deduplicated like the first.
    await resolveProject({ cwd: dir, warn: sink });
    expect(unknownKeyMessages()).toHaveLength(2);
  });

  it("names the full path for gitSource and navigation-entry keys", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `import { gitSource } from "LEADTYPE_ENTRY";

export default {
  ${IDENTITY},
  sources: {
    upstream: gitSource({
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      cacheDir: ".leadtype/acme",
      branch: "main",
      collections: {
        docs: {
          dir: "docs",
          routePrefix: "/docs",
          navigation: [{ title: "G", base: "g", pages: [{ include: "**", pins: ["x"] }] }],
        },
      },
    }),
  },
};`.replace("LEADTYPE_ENTRY", LEADTYPE_ENTRY),
    });

    const project = await resolveProject({ cwd: dir });

    const owners = project.diagnostics
      .filter((entry) => entry.id === "config.unknown-key")
      .map((entry) => entry.owner);
    expect(owners).toContain("sources.upstream.branch");
    expect(owners).toContain(
      "sources.upstream.collections.docs.navigation[0].pages[0].pins"
    );
  });
});

describe("repeated --docs-dir with an authored tree", () => {
  // Pinned to what `generate` actually does with this shape (verified against
  // the real command): every `--docs-dir` is staged into one mirror — extras
  // under their folder names — the top-level `navigation` resolves over that
  // union (`guides/setup` lives in the *second* directory and serves at
  // `/docs/guides/setup`), pages the tree never names fall back to the
  // ungrouped root, and no navigation is derived for any directory. The build
  // exits 0.
  async function authoredMultiDir(): Promise<string> {
    return await fixture({
      "leadtype.config.ts": `export default {
  ${IDENTITY},
  navigation: ["guides/setup"],
};`,
      "docs/index.mdx": page("Home"),
      "guides/setup.mdx": page("Setup"),
    });
  }

  it("resolves the authored tree over the union of the staged dirs", async () => {
    const dir = await authoredMultiDir();
    const project = await resolveProject({
      cwd: dir,
      docsDirs: ["docs", "guides"],
    });

    // The primary carries the union view; the extra dir stays a collection
    // (its mount and existence are still worth reporting) but gets no
    // derived tree — `generate` derives nothing once a tree is authored.
    expect(project.collections[0]?.navigationExtraDirs).toEqual([
      {
        dir: path.join(dir, "guides"),
        pathPrefix: "guides",
        urlPrefix: "/docs/guides",
      },
    ]);
    expect(project.collections[1]?.navigation).toBeUndefined();
    expect(project.inference.values).toEqual([]);

    const navigation = await resolveProjectNavigation(project);
    // Resolving `guides/setup` against the primary directory alone reported
    // `nav.unresolvable` — and doctor exit 1 — for a build that succeeds.
    expect(navigation.diagnostics).toEqual([]);
    // One manifest, like generate's single staged tree: the extra dir's pages
    // resolve through the primary, not a second per-directory manifest.
    expect(navigation.collections).toHaveLength(1);
    expect(navigation.origin).toBe("explicit");
    expect(navigation.collections[0]?.routedUrlPaths).toEqual(
      expect.arrayContaining(["/docs/guides/setup", "/docs"])
    );
    expect(navigation.routedPages).toBe(2);
    // The page the tree never names falls back to the root — drift worth
    // reporting, exactly as the build renders it.
    expect(navigation.unplaced).toEqual(["/docs"]);
  });

  it("derives no trees for extra dirs in a localized project", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  ${IDENTITY},
  i18n: { defaultLocale: "en", locales: ["en", "fr"] },
};`,
      "docs/en/index.mdx": page("Home"),
      "guides/en/setup.mdx": page("Setup"),
    });

    const project = await resolveProject({
      cwd: dir,
      docsDirs: ["docs", "guides"],
    });

    // `generate` skips derivation entirely for i18n projects. The primary
    // already followed that opt-out; the synthesized extras used to derive
    // anyway, so doctor/nav reported locale-keyed sections for the extra dirs
    // that the build never produces.
    expect(project.collections).toHaveLength(2);
    for (const collection of project.collections) {
      expect(collection.navigation).toBeUndefined();
    }
    expect(project.inference.values.map((entry) => entry.field)).not.toContain(
      "navigation"
    );
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

  it("warns every distinct sink, once per sink", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  ${IDENTITY},
  collections: { docs: { dir: "content", prefix: "/docs" } },
};`,
      "content/index.mdx": page("Home"),
    });

    // The dedupe used to be keyed on the config path but process-global,
    // while the sink is per-caller: the second resolve of the same config in
    // one process warned nobody — and `nav`, whose report carries no
    // diagnostics, lost the warning entirely.
    const first: string[] = [];
    const second: string[] = [];
    const firstSink = (call: { human: { message: string } }) =>
      first.push(call.human.message);
    await resolveProject({ cwd: dir, warn: firstSink });
    await resolveProject({ cwd: dir, warn: firstSink });
    await resolveProject({
      cwd: dir,
      warn: (call) => second.push(call.human.message),
    });

    // Once per sink: the repeat resolve with the same sink stays quiet, the
    // fresh sink still hears about it.
    expect(first.filter((message) => message.includes("prefix"))).toHaveLength(
      1
    );
    expect(second.filter((message) => message.includes("prefix"))).toHaveLength(
      1
    );
  });
});
