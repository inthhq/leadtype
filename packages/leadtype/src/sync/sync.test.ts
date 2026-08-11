import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeDocsConfig } from "../config/normalize";
import { type DocsCollection, type DocsConfig, gitSource } from "../llm/llm";
import {
  defaultCacheDir,
  type GitRunner,
  type GitRunResult,
  isShaRef,
  projectRemoteSources,
  repositorySlug,
  resolveAllCollections,
  resolveCollection,
  SYNC_MANIFEST_FILE,
  sameSparse,
  syncSources,
} from "./sync";

type RecordedCall = { args: string[]; cwd?: string };

const product = { name: "Example", tagline: "Example docs." };

/**
 * Derive the resolved source graph the way every real caller does: through the
 * normalizer. Sync has no derivation of its own to hand a collections map to —
 * the graph it acts on is the one normalize reports.
 */
function sourcesFor(collections: Record<string, DocsCollection>) {
  return normalizeDocsConfig({ product, collections }).resolved.sources;
}

async function seedFakeCheckout(
  cacheDir: string,
  files: Record<string, string>
): Promise<void> {
  await mkdir(path.join(cacheDir, ".git"), { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(cacheDir, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

const ok = (stdout = ""): GitRunResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr: string): GitRunResult => ({
  exitCode: 1,
  stdout: "",
  stderr,
});

describe("repositorySlug", () => {
  it("derives a filesystem-safe slug from https URLs", () => {
    expect(repositorySlug("https://github.com/c15t/c15t")).toBe("c15t-c15t");
    expect(repositorySlug("https://github.com/c15t/c15t.git")).toBe(
      "c15t-c15t"
    );
  });

  it("derives a slug from scp-like git URLs", () => {
    expect(repositorySlug("git@github.com:c15t/c15t.git")).toBe("c15t-c15t");
  });

  it("replaces unsafe characters with dashes", () => {
    expect(repositorySlug("https://gitlab.com/group/sub/repo")).toBe(
      "group-sub-repo"
    );
  });
});

describe("isShaRef", () => {
  it("matches 7-40 char hex strings", () => {
    expect(isShaRef("abc1234")).toBe(true);
    expect(isShaRef("a".repeat(40))).toBe(true);
  });

  it("rejects refs that look like branches or tags", () => {
    expect(isShaRef("main")).toBe(false);
    expect(isShaRef("v1.2.3")).toBe(false);
    expect(isShaRef("abc12")).toBe(false);
    expect(isShaRef("a".repeat(41))).toBe(false);
  });
});

describe("defaultCacheDir", () => {
  it("includes slug and ref", () => {
    expect(defaultCacheDir("https://github.com/c15t/c15t", "main")).toBe(
      path.join(".leadtype", "sources", "c15t-c15t@main")
    );
  });
});

describe("resolveAllCollections", () => {
  const configDir = "/repo";

  it("resolves local collections to absolute dir under configDir", () => {
    const collections: Record<string, DocsCollection> = {
      docs: { dir: "./docs" },
    };
    const [resolved] = resolveAllCollections(collections, configDir);
    expect(resolved.remote).toBeUndefined();
    expect(resolved.absoluteDir).toBe(path.resolve(configDir, "./docs"));
    expect(resolved.urlPrefix).toBe("/docs");
  });

  it("resolves remote collections to <cacheDir>/<dir>", () => {
    const collections: Record<string, DocsCollection> = {
      docs: {
        repository: "https://github.com/c15t/c15t",
        ref: "main",
        dir: "docs",
      },
    };
    const [resolved] = resolveAllCollections(collections, configDir);
    expect(resolved.remote).toEqual({
      repository: "https://github.com/c15t/c15t",
      ref: "main",
      cacheDir: path.resolve(configDir, ".leadtype/sources/c15t-c15t@main"),
      collectionKeys: ["docs"],
    });
    expect(resolved.absoluteDir).toBe(
      path.resolve(configDir, ".leadtype/sources/c15t-c15t@main/docs")
    );
  });

  it("defaults prefix to /<key> when omitted", () => {
    const collections: Record<string, DocsCollection> = {
      swift: { dir: "docs", repository: "https://github.com/c15t/swift" },
    };
    const [resolved] = resolveAllCollections(collections, configDir);
    expect(resolved.urlPrefix).toBe("/swift");
  });
});

describe("projectRemoteSources", () => {
  const configDir = "/repo";

  it("projects the resolved graph's git sources with absolute cache dirs", () => {
    const sources = projectRemoteSources(
      sourcesFor({
        docs: {
          repository: "https://github.com/c15t/c15t",
          ref: "main",
          dir: "docs",
        },
        changelog: {
          repository: "https://github.com/c15t/c15t",
          ref: "main",
          dir: "changelog",
        },
      }),
      configDir
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: "https://github.com/c15t/c15t#main",
      repository: "https://github.com/c15t/c15t",
      ref: "main",
      refKind: "mutable",
      cacheDir: path.resolve(configDir, ".leadtype/sources/c15t-c15t@main"),
    });
    expect(sources[0].collectionKeys.sort()).toEqual(["changelog", "docs"]);
  });

  it("keeps separate entries for different refs", () => {
    const sources = projectRemoteSources(
      sourcesFor({
        stable: {
          repository: "https://github.com/c15t/c15t",
          ref: "v1.0.0",
          dir: "docs",
        },
        next: {
          repository: "https://github.com/c15t/c15t",
          ref: "main",
          dir: "docs",
        },
      }),
      configDir
    );
    expect(sources).toHaveLength(2);
  });

  it("drops the local source", () => {
    expect(
      projectRemoteSources(sourcesFor({ docs: { dir: "./docs" } }), configDir)
    ).toEqual([]);
  });

  it("resolves an explicit cacheDir against the config directory", () => {
    const sources = projectRemoteSources(
      sourcesFor({
        docs: {
          repository: "https://github.com/c15t/c15t",
          ref: "main",
          cacheDir: "./vendor/c15t",
          dir: "docs",
        },
      }),
      configDir
    );
    expect(sources[0].cacheDir).toBe(path.resolve(configDir, "./vendor/c15t"));
  });
});

describe("syncSources", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "leadtype-sync-"));
  });

  afterEach(async () => {
    await rm(configDir, { force: true, recursive: true });
  });

  it("auto-clones a missing source and writes a manifest", async () => {
    const runner: GitRunner = async (args) => {
      if (args[0] === "clone") {
        const target = args.at(-1) as string;
        await seedFakeCheckout(target, { "README.md": "# repo\n" });
        return ok();
      }
      if (args[0] === "rev-parse") {
        return ok("abc1234\n");
      }
      return fail(`unexpected: ${args.join(" ")}`);
    };

    const result = await syncSources({
      mode: "auto",
      configDir,
      sources: sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
        },
      }),
      runner,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].status).toBe("fresh");
    expect(result.sources[0].commit).toBe("abc1234");

    const manifestRaw = await readFile(
      path.join(result.sources[0].source.cacheDir, SYNC_MANIFEST_FILE),
      "utf8"
    );
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.repository).toBe("https://github.com/example/repo");
    expect(manifest.ref).toBe("main");
    expect(manifest.commit).toBe("abc1234");
  });

  it("clones blobless and selects paths when sparse is set", async () => {
    const calls: RecordedCall[] = [];
    const runner: GitRunner = async (args, options) => {
      calls.push({ args, cwd: options?.cwd });
      if (args[0] === "clone") {
        await seedFakeCheckout(args.at(-1) as string, { "README.md": "# r\n" });
        return ok();
      }
      if (args[0] === "rev-parse") {
        return ok("abc1234\n");
      }
      return ok();
    };

    const result = await syncSources({
      mode: "auto",
      configDir,
      sources: sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
          sparse: ["docs", "packages"],
        },
      }),
      runner,
    });

    const clone = calls.find((call) => call.args[0] === "clone");
    // Blobless + --sparse checks out nothing up front, so git only fetches the
    // blobs behind the selected paths — the whole point of the option.
    expect(clone?.args).toContain("--filter=blob:none");
    expect(clone?.args).toContain("--sparse");

    const sparseSet = calls.find((call) => call.args[0] === "sparse-checkout");
    expect(sparseSet?.args).toEqual([
      "sparse-checkout",
      "set",
      "--",
      "docs",
      "packages",
    ]);
    expect(sparseSet?.cwd).toBe(result.sources[0].source.cacheDir);
  });

  it("records the sparse paths in the manifest", async () => {
    const runner: GitRunner = async (args) => {
      if (args[0] === "clone") {
        await seedFakeCheckout(args.at(-1) as string, { "README.md": "# r\n" });
        return ok();
      }
      if (args[0] === "rev-parse") {
        return ok("abc1234\n");
      }
      return ok();
    };

    const result = await syncSources({
      mode: "auto",
      configDir,
      sources: sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
          sparse: ["docs"],
        },
      }),
      runner,
    });

    const manifest = JSON.parse(
      await readFile(
        path.join(result.sources[0].source.cacheDir, SYNC_MANIFEST_FILE),
        "utf8"
      )
    );
    expect(manifest.sparse).toEqual(["docs"]);
  });

  it("re-clones when the cached checkout has a different path set", async () => {
    const cacheDir = path.resolve(
      configDir,
      ".leadtype/sources/example-repo@main"
    );
    await seedFakeCheckout(cacheDir, {
      "docs/index.mdx": "---\ntitle: Hi\n---\n",
    });
    await writeFile(
      path.join(cacheDir, SYNC_MANIFEST_FILE),
      `${JSON.stringify({
        version: 1,
        repository: "https://github.com/example/repo",
        ref: "main",
        commit: "deadbeef",
        syncedAt: "2026-05-14T00:00:00.000Z",
        sparse: ["docs"],
      })}\n`
    );

    const calls: RecordedCall[] = [];
    const runner: GitRunner = async (args, options) => {
      calls.push({ args, cwd: options?.cwd });
      if (args[0] === "clone") {
        await seedFakeCheckout(args.at(-1) as string, { "README.md": "# r\n" });
        return ok();
      }
      if (args[0] === "rev-parse") {
        return ok("beef999\n");
      }
      return ok();
    };

    const result = await syncSources({
      mode: "auto",
      configDir,
      sources: sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
          // `packages` was added — the cached checkout does not contain it, and
          // a checkout missing a directory looks identical to a complete one.
          sparse: ["docs", "packages"],
        },
      }),
      runner,
    });

    expect(result.sources[0].status).toBe("fresh");
    expect(calls.some((call) => call.args[0] === "clone")).toBe(true);
  });

  it("never sees collections that share an acquisition but disagree on paths", () => {
    // The graph sync consumes is validated when it is resolved: a sparse
    // disagreement fails at normalize time, before any git process runs.
    expect(() =>
      sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
          sparse: ["docs"],
        },
        changelog: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "changelog",
          sparse: ["changelog"],
        },
      })
    ).toThrow(/different sparse paths.*One checkout has one path set/s);
  });

  it("auto leaves an up-to-date cache untouched", async () => {
    const cacheDir = path.resolve(
      configDir,
      ".leadtype/sources/example-repo@main"
    );
    await seedFakeCheckout(cacheDir, {
      "docs/index.mdx": "---\ntitle: Hi\n---\n",
    });
    await writeFile(
      path.join(cacheDir, SYNC_MANIFEST_FILE),
      `${JSON.stringify(
        {
          version: 1,
          repository: "https://github.com/example/repo",
          ref: "main",
          commit: "deadbeef",
          syncedAt: "2026-05-14T00:00:00.000Z",
        },
        null,
        2
      )}\n`
    );

    const calls: RecordedCall[] = [];
    const runner: GitRunner = async (args, options) => {
      calls.push({ args, cwd: options?.cwd });
      return ok();
    };

    const result = await syncSources({
      mode: "auto",
      configDir,
      sources: sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
        },
      }),
      runner,
    });

    expect(calls).toEqual([]);
    expect(result.sources[0].status).toBe("cached");
    expect(result.sources[0].commit).toBe("deadbeef");
  });

  it("refresh fast-forwards an existing matching checkout", async () => {
    const cacheDir = path.resolve(
      configDir,
      ".leadtype/sources/example-repo@main"
    );
    await seedFakeCheckout(cacheDir, { "docs/index.mdx": "stale\n" });
    await writeFile(
      path.join(cacheDir, SYNC_MANIFEST_FILE),
      `${JSON.stringify(
        {
          version: 1,
          repository: "https://github.com/example/repo",
          ref: "main",
          commit: "oldsha1",
          syncedAt: "2026-05-14T00:00:00.000Z",
        },
        null,
        2
      )}\n`
    );

    const runner: GitRunner = async (args) => {
      if (args[0] === "fetch") {
        return ok();
      }
      if (args[0] === "reset") {
        return ok();
      }
      if (args[0] === "rev-parse") {
        return ok("newsha2\n");
      }
      return fail(`unexpected: ${args.join(" ")}`);
    };

    const result = await syncSources({
      mode: "refresh",
      configDir,
      sources: sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
        },
      }),
      runner,
    });

    expect(result.sources[0].status).toBe("refreshed");
    expect(result.sources[0].commit).toBe("newsha2");
  });

  it("reports `fresh` (not `refreshed`) when refresh re-clones after ref drift", async () => {
    const cacheDir = path.resolve(
      configDir,
      ".leadtype/sources/example-repo@main"
    );
    await seedFakeCheckout(cacheDir, { "docs/index.mdx": "stale\n" });
    // Manifest pinned to an OLD ref; the live config now wants `main`.
    await writeFile(
      path.join(cacheDir, SYNC_MANIFEST_FILE),
      `${JSON.stringify(
        {
          version: 1,
          repository: "https://github.com/example/repo",
          ref: "old-branch",
          commit: "oldsha",
          syncedAt: "2026-05-14T00:00:00.000Z",
        },
        null,
        2
      )}\n`
    );

    const runner: GitRunner = async (args) => {
      if (args[0] === "clone") {
        const target = args.at(-1) as string;
        await seedFakeCheckout(target, { "docs/index.mdx": "" });
        return ok();
      }
      if (args[0] === "rev-parse") {
        return ok("newsha\n");
      }
      return fail(`unexpected: ${args.join(" ")}`);
    };

    const result = await syncSources({
      mode: "refresh",
      configDir,
      sources: sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
        },
      }),
      runner,
    });

    expect(result.sources[0].status).toBe("fresh");
  });

  it("offline errors when cache is missing", async () => {
    await expect(
      syncSources({
        mode: "offline",
        configDir,
        sources: sourcesFor({
          docs: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "docs",
          },
        }),
        runner: async () => fail("should not be called"),
      })
    ).rejects.toThrow(/--offline.*cache miss/);
  });

  it("missing mode names the collection in the error", async () => {
    await expect(
      syncSources({
        mode: "missing",
        configDir,
        sources: sourcesFor({
          changelog: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "changelog",
          },
        }),
        runner: async () => fail("should not be called"),
      })
    ).rejects.toThrow(/\[changelog\]/);
  });

  it("clones once when two collections share the same (repo, ref)", async () => {
    const calls: RecordedCall[] = [];
    const runner: GitRunner = async (args, options) => {
      calls.push({ args, cwd: options?.cwd });
      if (args[0] === "clone") {
        const target = args.at(-1) as string;
        await seedFakeCheckout(target, { "docs/x.mdx": "" });
        return ok();
      }
      if (args[0] === "rev-parse") {
        return ok("sha1\n");
      }
      return fail(`unexpected: ${args.join(" ")}`);
    };

    const result = await syncSources({
      mode: "auto",
      configDir,
      sources: sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
        },
        changelog: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "changelog",
        },
      }),
      runner,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].source.collectionKeys.sort()).toEqual([
      "changelog",
      "docs",
    ]);
    const cloneCalls = calls.filter((c) => c.args[0] === "clone");
    expect(cloneCalls).toHaveLength(1);
  });

  it("uses full clone + checkout for SHA refs", async () => {
    const calls: RecordedCall[] = [];
    const runner: GitRunner = async (args, options) => {
      calls.push({ args, cwd: options?.cwd });
      if (args[0] === "clone") {
        const target = args.at(-1) as string;
        await seedFakeCheckout(target, {});
        return ok();
      }
      if (args[0] === "checkout") {
        return ok();
      }
      if (args[0] === "rev-parse") {
        return ok("a1b2c3d\n");
      }
      return fail(`unexpected: ${args.join(" ")}`);
    };

    await syncSources({
      mode: "auto",
      configDir,
      sources: sourcesFor({
        docs: {
          repository: "https://github.com/example/repo",
          ref: "a1b2c3d",
          dir: "docs",
        },
      }),
      runner,
    });

    const cloneCall = calls.find((c) => c.args[0] === "clone");
    const checkoutCall = calls.find((c) => c.args[0] === "checkout");
    expect(cloneCall?.args).not.toContain("--branch");
    expect(checkoutCall?.args).toEqual(["checkout", "a1b2c3d"]);
  });

  it("surfaces git clone failures with actionable detail", async () => {
    const runner: GitRunner = async () => fail("fatal: repository not found");

    await expect(
      syncSources({
        mode: "auto",
        configDir,
        sources: sourcesFor({
          docs: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "docs",
          },
        }),
        runner,
      })
    ).rejects.toThrow(/repository not found/);
  });

  it("filters sources by repoFilter substring", async () => {
    const runner: GitRunner = async (args) => {
      if (args[0] === "clone") {
        const target = args.at(-1) as string;
        await seedFakeCheckout(target, {});
        return ok();
      }
      if (args[0] === "rev-parse") {
        return ok("sha\n");
      }
      return fail(`unexpected: ${args.join(" ")}`);
    };

    const result = await syncSources({
      mode: "auto",
      configDir,
      sources: sourcesFor({
        a: {
          repository: "https://github.com/c15t/c15t",
          ref: "main",
          dir: "docs",
        },
        b: {
          repository: "https://github.com/c15t/swift",
          ref: "main",
          dir: "docs",
        },
      }),
      runner,
      repoFilter: "swift",
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].source.repository).toContain("swift");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].repository).toContain("c15t/c15t");
  });

  it("treats local-only collections as no-op for sync", async () => {
    const runner: GitRunner = async () => fail("should not be called");
    const result = await syncSources({
      mode: "auto",
      configDir,
      sources: sourcesFor({ docs: { dir: "./docs" } }),
      runner,
    });
    expect(result.sources).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("translates ENOENT from the runner into a `git not installed` error", async () => {
    const runner: GitRunner = async () => {
      const err = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    };

    await expect(
      syncSources({
        mode: "auto",
        configDir,
        sources: sourcesFor({
          docs: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "docs",
          },
        }),
        runner,
      })
    ).rejects.toThrow(/`git` is not installed or not on PATH/);
  });

  it("propagates non-ENOENT runner errors verbatim", async () => {
    const runner: GitRunner = async () => {
      throw new Error("nope, something else broke");
    };

    await expect(
      syncSources({
        mode: "auto",
        configDir,
        sources: sourcesFor({
          docs: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "docs",
          },
        }),
        runner,
      })
    ).rejects.toThrow(/something else broke/);
  });
});

/**
 * The class of bug this file previously could not catch: each subsystem tested
 * only against itself, so sync's private source graph could drift from the one
 * normalize reports to doctor and `generate --json`. These tests assert, for a
 * matrix of authoring shapes, that the graph sync acts on IS the resolved
 * graph — same identities, same cache dirs, same sparse sets — and that the
 * per-collection projection (`resolveCollection`) reads from those same
 * checkouts.
 */
describe("the graph sync acts on is the graph normalize reports", () => {
  const matrix: { name: string; config: DocsConfig }[] = [
    {
      name: "flat collections sharing one acquisition",
      config: {
        product,
        collections: {
          docs: {
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            dir: "docs",
          },
          changelog: {
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            dir: "changelog",
          },
        },
      },
    },
    {
      name: "a named gitSource group with cacheDir and sparse",
      config: {
        product,
        sources: {
          acme: gitSource({
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            cacheDir: ".leadtype/acme",
            sparse: ["docs", "changelog"],
            collections: {
              docs: { dir: "docs" },
              changelog: { dir: "changelog" },
            },
          }),
        },
      },
    },
    {
      name: "a source group beside a flat collection on the same acquisition",
      config: {
        product,
        collections: {
          flat: {
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            dir: "extra",
          },
        },
        sources: {
          acme: gitSource({
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            collections: { docs: { dir: "docs" } },
          }),
        },
      },
    },
    {
      name: "an explicit cacheDir agreed across flat collections",
      config: {
        product,
        collections: {
          docs: {
            repository: "https://github.com/acme/acme.git",
            ref: "v1.2.3",
            cacheDir: "./vendor/acme",
            dir: "docs",
          },
          changelog: {
            repository: "https://github.com/acme/acme.git",
            ref: "v1.2.3",
            cacheDir: "./vendor/acme",
            dir: "changelog",
          },
        },
      },
    },
    {
      name: "sparse paths agreed in a different order",
      config: {
        product,
        collections: {
          docs: {
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            dir: "docs",
            sparse: ["docs", "packages"],
          },
          api: {
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            dir: "packages",
            sparse: ["packages", "docs"],
          },
        },
      },
    },
    {
      name: "local and remote collections mixed",
      config: {
        product,
        collections: {
          guides: { dir: "./guides" },
          docs: {
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            dir: "docs",
          },
        },
      },
    },
  ];

  for (const { name, config } of matrix) {
    it(`${name}: every collection reads from its resolved source's checkout`, () => {
      const configDir = "/repo";
      const { config: canonical, resolved } = normalizeDocsConfig(config, {
        configDir,
      });
      const projected = projectRemoteSources(resolved.sources, configDir);

      // Every git source in the resolved graph is exactly one sync target,
      // under the same id.
      expect(projected.map((source) => source.id)).toEqual(
        resolved.sources
          .filter((source) => source.kind === "git")
          .map((source) => source.id)
      );

      const projectedById = new Map(
        projected.map((source) => [source.id, source])
      );
      for (const collection of resolved.collections) {
        const source = projectedById.get(collection.sourceId);
        const authored = canonical.collections?.[collection.key];
        if (!authored) {
          throw new Error(`missing canonical collection ${collection.key}`);
        }
        const perCollection = resolveCollection(
          collection.key,
          authored,
          configDir
        );
        if (!source) {
          // A collection outside the projection must be local on both sides.
          expect(collection.sourceId).toBe("local");
          expect(perCollection.remote).toBeUndefined();
          continue;
        }
        expect(perCollection.remote?.repository).toBe(source.repository);
        expect(perCollection.remote?.ref).toBe(source.ref);
        expect(perCollection.remote?.cacheDir).toBe(source.cacheDir);
        expect(sameSparse(perCollection.remote?.sparse, source.sparse)).toBe(
          true
        );
        expect(
          perCollection.absoluteDir.startsWith(source.cacheDir + path.sep)
        ).toBe(true);
      }
    });

    it(`${name}: sync clones exactly the resolved sources' cache dirs`, async () => {
      const configDir = await mkdtemp(path.join(tmpdir(), "leadtype-graph-"));
      try {
        const { resolved } = normalizeDocsConfig(config, { configDir });
        const projected = projectRemoteSources(resolved.sources, configDir);
        const cloneTargets: string[] = [];
        const runner: GitRunner = async (args) => {
          if (args[0] === "clone") {
            const target = args.at(-1) as string;
            cloneTargets.push(target);
            await seedFakeCheckout(target, {});
            return ok();
          }
          if (args[0] === "rev-parse") {
            return ok("abc1234\n");
          }
          return ok();
        };

        const result = await syncSources({
          mode: "auto",
          configDir,
          sources: resolved.sources,
          runner,
        });

        expect(cloneTargets.sort()).toEqual(
          projected.map((source) => source.cacheDir).sort()
        );
        expect(
          result.sources.map(({ source }) => ({
            id: source.id,
            cacheDir: source.cacheDir,
            collectionKeys: source.collectionKeys,
          }))
        ).toEqual(
          projected.map((source) => ({
            id: source.id,
            cacheDir: source.cacheDir,
            collectionKeys: source.collectionKeys,
          }))
        );
      } finally {
        await rm(configDir, { force: true, recursive: true });
      }
    });
  }
});
