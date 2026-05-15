import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocsCollection } from "../llm";
import {
  defaultCacheDir,
  type GitRunner,
  type GitRunResult,
  isShaRef,
  repositorySlug,
  resolveAllCollections,
  resolveRemoteSources,
  SYNC_MANIFEST_FILE,
  syncCollections,
} from "./sync";

type RecordedCall = { args: string[]; cwd?: string };

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

describe("resolveRemoteSources", () => {
  const configDir = "/repo";

  it("dedupes two collections sharing the same (repo, ref)", () => {
    const collections: Record<string, DocsCollection> = {
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
    };
    const sources = resolveRemoteSources(collections, configDir);
    expect(sources).toHaveLength(1);
    expect(sources[0].collectionKeys.sort()).toEqual(["changelog", "docs"]);
  });

  it("keeps separate entries for different refs", () => {
    const collections: Record<string, DocsCollection> = {
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
    };
    expect(resolveRemoteSources(collections, configDir)).toHaveLength(2);
  });

  it("ignores local collections", () => {
    const collections: Record<string, DocsCollection> = {
      docs: { dir: "./docs" },
    };
    expect(resolveRemoteSources(collections, configDir)).toEqual([]);
  });

  it("errors on conflicting cacheDir for the same (repo, ref)", () => {
    const collections: Record<string, DocsCollection> = {
      docs: {
        repository: "https://github.com/c15t/c15t",
        ref: "main",
        cacheDir: "./cache-a",
        dir: "docs",
      },
      changelog: {
        repository: "https://github.com/c15t/c15t",
        ref: "main",
        cacheDir: "./cache-b",
        dir: "changelog",
      },
    };
    expect(() => resolveRemoteSources(collections, configDir)).toThrow(
      /different cacheDir/
    );
  });
});

describe("syncCollections", () => {
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

    const result = await syncCollections({
      mode: "auto",
      configDir,
      collections: {
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
        },
      },
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

    const result = await syncCollections({
      mode: "auto",
      configDir,
      collections: {
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
        },
      },
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

    const result = await syncCollections({
      mode: "refresh",
      configDir,
      collections: {
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
        },
      },
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

    const result = await syncCollections({
      mode: "refresh",
      configDir,
      collections: {
        docs: {
          repository: "https://github.com/example/repo",
          ref: "main",
          dir: "docs",
        },
      },
      runner,
    });

    expect(result.sources[0].status).toBe("fresh");
  });

  it("offline errors when cache is missing", async () => {
    await expect(
      syncCollections({
        mode: "offline",
        configDir,
        collections: {
          docs: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "docs",
          },
        },
        runner: async () => fail("should not be called"),
      })
    ).rejects.toThrow(/--offline.*cache miss/);
  });

  it("missing mode names the collection in the error", async () => {
    await expect(
      syncCollections({
        mode: "missing",
        configDir,
        collections: {
          changelog: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "changelog",
          },
        },
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

    const result = await syncCollections({
      mode: "auto",
      configDir,
      collections: {
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
      },
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

    await syncCollections({
      mode: "auto",
      configDir,
      collections: {
        docs: {
          repository: "https://github.com/example/repo",
          ref: "a1b2c3d",
          dir: "docs",
        },
      },
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
      syncCollections({
        mode: "auto",
        configDir,
        collections: {
          docs: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "docs",
          },
        },
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

    const result = await syncCollections({
      mode: "auto",
      configDir,
      collections: {
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
      },
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
    const result = await syncCollections({
      mode: "auto",
      configDir,
      collections: { docs: { dir: "./docs" } },
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
      syncCollections({
        mode: "auto",
        configDir,
        collections: {
          docs: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "docs",
          },
        },
        runner,
      })
    ).rejects.toThrow(/`git` is not installed or not on PATH/);
  });

  it("propagates non-ENOENT runner errors verbatim", async () => {
    const runner: GitRunner = async () => {
      throw new Error("nope, something else broke");
    };

    await expect(
      syncCollections({
        mode: "auto",
        configDir,
        collections: {
          docs: {
            repository: "https://github.com/example/repo",
            ref: "main",
            dir: "docs",
          },
        },
        runner,
      })
    ).rejects.toThrow(/something else broke/);
  });
});
