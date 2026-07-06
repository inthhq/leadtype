import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashRedirectContent,
  readPathsLockfile,
  updateDocsRedirects,
} from "./node";
import {
  computeDocsRedirects,
  type DocsPathsLockfile,
  REDIRECT_STATUS_GONE,
  REDIRECT_STATUS_MOVED,
  resolveRedirect,
} from "./redirects";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-redirects-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("hashRedirectContent", () => {
  it("ignores frontmatter and edge whitespace", () => {
    const moved = hashRedirectContent(
      "---\ntitle: A\nlastModified: 2026-07-01\n---\n# Body\n\nText.\n"
    );
    const original = hashRedirectContent(
      "---\ntitle: A\nlastModified: 2026-01-01\n---\n\n# Body\n\nText."
    );
    expect(moved).toBe(original);
    expect(hashRedirectContent("# Other body\n")).not.toBe(original);
  });
});

describe("computeDocsRedirects", () => {
  const lockfile = (
    pages: { path: string; hash: string }[],
    redirects: DocsPathsLockfile["redirects"] = []
  ): DocsPathsLockfile => ({ version: 1, pages, redirects });

  it("emits nothing on a first run and records all pages", () => {
    const result = computeDocsRedirects({
      pages: [{ urlPath: "/docs/a", hash: "h1" }],
    });
    expect(result.redirects).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.lockfile.pages).toEqual([{ path: "/docs/a", hash: "h1" }]);
  });

  it("detects a pure move by content hash", () => {
    const result = computeDocsRedirects({
      previous: lockfile([{ path: "/docs/guides/x", hash: "h1" }]),
      pages: [{ urlPath: "/docs/concepts/x", hash: "h1" }],
    });
    expect(result.moved).toEqual([
      { from: "/docs/guides/x", to: "/docs/concepts/x" },
    ]);
    expect(result.redirects).toEqual([
      {
        from: "/docs/guides/x",
        to: "/docs/concepts/x",
        status: REDIRECT_STATUS_MOVED,
      },
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it("refuses to guess when hashes are ambiguous", () => {
    const result = computeDocsRedirects({
      previous: lockfile([
        { path: "/docs/a", hash: "same" },
        { path: "/docs/b", hash: "same" },
      ]),
      pages: [
        { urlPath: "/docs/c", hash: "same" },
        { urlPath: "/docs/d", hash: "same" },
      ],
    });
    expect(result.moved).toEqual([]);
    expect(result.unmatched.sort()).toEqual(["/docs/a", "/docs/b"]);
  });

  it("honors explicit redirectFrom over hash matching", () => {
    const result = computeDocsRedirects({
      previous: lockfile([{ path: "/docs/old", hash: "h1" }]),
      pages: [
        { urlPath: "/docs/new", hash: "h2", redirectFrom: ["/docs/old"] },
      ],
    });
    expect(result.redirects).toEqual([
      { from: "/docs/old", to: "/docs/new", status: REDIRECT_STATUS_MOVED },
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it("throws when redirectFrom claims a live page", () => {
    expect(() =>
      computeDocsRedirects({
        pages: [
          { urlPath: "/docs/a", hash: "h1" },
          { urlPath: "/docs/b", hash: "h2", redirectFrom: ["/docs/a"] },
        ],
      })
    ).toThrow('redirectFrom path "/docs/a"');
  });

  it("turns acknowledged removals into 410 entries", () => {
    const result = computeDocsRedirects({
      previous: lockfile([{ path: "/docs/dead", hash: "h1" }]),
      pages: [{ urlPath: "/docs/kept", hash: "h2" }],
      removed: ["/docs/dead"],
    });
    expect(result.redirects).toEqual([
      { from: "/docs/dead", status: REDIRECT_STATUS_GONE },
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it("reports unexplained disappearances as unmatched", () => {
    const result = computeDocsRedirects({
      previous: lockfile([{ path: "/docs/gone", hash: "h1" }]),
      pages: [{ urlPath: "/docs/kept", hash: "h2" }],
    });
    expect(result.unmatched).toEqual(["/docs/gone"]);
  });

  it("carries prior redirects forward and collapses chains", () => {
    const result = computeDocsRedirects({
      previous: lockfile(
        [{ path: "/docs/b", hash: "h1" }],
        [{ from: "/docs/a", to: "/docs/b", status: REDIRECT_STATUS_MOVED }]
      ),
      // /docs/b moves to /docs/c → the old /docs/a entry must follow.
      pages: [{ urlPath: "/docs/c", hash: "h1" }],
    });
    expect(result.redirects).toEqual([
      { from: "/docs/a", to: "/docs/c", status: REDIRECT_STATUS_MOVED },
      { from: "/docs/b", to: "/docs/c", status: REDIRECT_STATUS_MOVED },
    ]);
  });

  it("drops carried redirects whose from-path is live again", () => {
    const result = computeDocsRedirects({
      previous: lockfile(
        [{ path: "/docs/b", hash: "h1" }],
        [{ from: "/docs/a", to: "/docs/b", status: REDIRECT_STATUS_MOVED }]
      ),
      pages: [
        { urlPath: "/docs/a", hash: "h9" },
        { urlPath: "/docs/b", hash: "h1" },
      ],
    });
    expect(result.redirects).toEqual([]);
  });

  it("converts carried redirects into 410 when their target is removed", () => {
    const result = computeDocsRedirects({
      previous: lockfile(
        [{ path: "/docs/b", hash: "h1" }],
        [{ from: "/docs/a", to: "/docs/b", status: REDIRECT_STATUS_MOVED }]
      ),
      pages: [{ urlPath: "/docs/kept", hash: "h2" }],
      removed: ["/docs/b"],
    });
    expect(result.redirects).toEqual([
      { from: "/docs/a", status: REDIRECT_STATUS_GONE },
      { from: "/docs/b", status: REDIRECT_STATUS_GONE },
    ]);
  });
});

describe("resolveRedirect", () => {
  const redirects = [
    { from: "/docs/old", to: "/docs/new", status: REDIRECT_STATUS_MOVED },
    { from: "/docs/dead", status: REDIRECT_STATUS_GONE },
  ];

  it("matches direct paths and normalizes trailing slashes", () => {
    expect(resolveRedirect("/docs/old", redirects)?.to).toBe("/docs/new");
    expect(resolveRedirect("/docs/old/", redirects)?.to).toBe("/docs/new");
    expect(resolveRedirect("/docs/other", redirects)).toBeUndefined();
  });

  it("follows the .md mirror surface", () => {
    const resolved = resolveRedirect("/docs/old.md", redirects);
    expect(resolved?.to).toBe("/docs/new.md");
    expect(resolved?.status).toBe(REDIRECT_STATUS_MOVED);
    expect(resolveRedirect("/docs/dead.md", redirects)?.status).toBe(
      REDIRECT_STATUS_GONE
    );
  });

  it("maps a root-route target to its /index.md mirror", () => {
    const rootRedirects = [
      { from: "/docs/moved-home", to: "/", status: REDIRECT_STATUS_MOVED },
    ];
    expect(resolveRedirect("/docs/moved-home.md", rootRedirects)?.to).toBe(
      "/index.md"
    );
  });
});

describe("updateDocsRedirects", () => {
  async function seedMirror(
    outDir: string,
    relativePath: string,
    body: string
  ): Promise<void> {
    const filePath = path.join(outDir, "docs", relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  }

  it("creates the lockfile, detects renames on later runs, and emits redirects.json", async () => {
    const dir = await createTempDir();
    const outDir = path.join(dir, "public");
    const lockfilePath = path.join(dir, "docs-src", "paths.lock.json");
    await mkdir(path.dirname(lockfilePath), { recursive: true });
    await seedMirror(
      outDir,
      "guides/x.md",
      "---\ntitle: X\n---\n# X\n\nBody.\n"
    );

    const first = await updateDocsRedirects({
      lockfilePath,
      outDir,
      pages: [{ urlPath: "/docs/guides/x", relativePath: "guides/x" }],
    });
    expect(first.redirects).toEqual([]);
    expect(await readPathsLockfile(lockfilePath)).toBeDefined();

    // Move the page (same body) and rerun.
    await rm(path.join(outDir, "docs", "guides", "x.md"));
    await seedMirror(
      outDir,
      "concepts/x.md",
      "---\ntitle: X\n---\n# X\n\nBody.\n"
    );
    const second = await updateDocsRedirects({
      lockfilePath,
      outDir,
      pages: [{ urlPath: "/docs/concepts/x", relativePath: "concepts/x" }],
    });
    expect(second.moved).toEqual([
      { from: "/docs/guides/x", to: "/docs/concepts/x" },
    ]);
    const artifact = JSON.parse(
      await readFile(path.join(outDir, "docs", "redirects.json"), "utf8")
    );
    expect(artifact.redirects).toEqual([
      {
        from: "/docs/guides/x",
        to: "/docs/concepts/x",
        status: REDIRECT_STATUS_MOVED,
      },
    ]);
  });

  it("reads index-route mirrors by relativePath, not the served URL", async () => {
    const dir = await createTempDir();
    const outDir = path.join(dir, "public");
    const lockfilePath = path.join(dir, "paths.lock.json");
    // Served at /docs/rest-api (and /docs/rest-api.md), but the emitted file
    // lives at docs/rest-api/index.md — the divergence that broke reading
    // mirrors via markdownUrlPath.
    await seedMirror(
      outDir,
      "rest-api/index.md",
      "---\ntitle: REST API\n---\n# REST API\n"
    );

    const result = await updateDocsRedirects({
      lockfilePath,
      outDir,
      pages: [{ urlPath: "/docs/rest-api", relativePath: "rest-api/index" }],
    });

    expect(result.lockfile.pages).toHaveLength(1);
    expect(result.lockfile.pages[0]?.path).toBe("/docs/rest-api");
  });

  it("fails loudly when a page disappears without a successor", async () => {
    const dir = await createTempDir();
    const outDir = path.join(dir, "public");
    const lockfilePath = path.join(dir, "paths.lock.json");
    await seedMirror(outDir, "a.md", "---\ntitle: A\n---\n# A\n");
    await updateDocsRedirects({
      lockfilePath,
      outDir,
      pages: [{ urlPath: "/docs/a", relativePath: "a" }],
    });

    await rm(path.join(outDir, "docs", "a.md"));
    await seedMirror(outDir, "b.md", "---\ntitle: B\n---\n# Entirely new.\n");
    await expect(
      updateDocsRedirects({
        lockfilePath,
        outDir,
        pages: [{ urlPath: "/docs/b", relativePath: "b" }],
      })
    ).rejects.toThrow("disappeared without a redirect");
  });

  it("reads redirectFrom frontmatter from emitted mirrors", async () => {
    const dir = await createTempDir();
    const outDir = path.join(dir, "public");
    const lockfilePath = path.join(dir, "paths.lock.json");
    await seedMirror(outDir, "old.md", "---\ntitle: Old\n---\n# Old body.\n");
    await updateDocsRedirects({
      lockfilePath,
      outDir,
      pages: [{ urlPath: "/docs/old", relativePath: "old" }],
    });

    await rm(path.join(outDir, "docs", "old.md"));
    await seedMirror(
      outDir,
      "new.md",
      '---\ntitle: New\nredirectFrom:\n  - "/docs/old"\n---\n# Rewritten body.\n'
    );
    const result = await updateDocsRedirects({
      lockfilePath,
      outDir,
      pages: [{ urlPath: "/docs/new", relativePath: "new" }],
    });
    expect(result.redirects).toEqual([
      { from: "/docs/old", to: "/docs/new", status: REDIRECT_STATUS_MOVED },
    ]);
  });
});
