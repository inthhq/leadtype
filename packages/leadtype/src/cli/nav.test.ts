import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeSyncManifest } from "../sync/sync";
import { type NavReport, parseNavArgs, runNavCommand } from "./nav";

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
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-nav-cli-"));
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
): Promise<{ code: number; report: NavReport }> {
  const capture = createCapture();
  const code = await runNavCommand(
    ["--src", srcDir, "--json", ...extra],
    capture.io
  );
  return { code, report: JSON.parse(capture.stdout) as NavReport };
}

describe("parseNavArgs", () => {
  it("rejects an unknown option", () => {
    expect(() => parseNavArgs(["--nope"])).toThrow(/unknown option/);
  });
});

describe("resolved tree", () => {
  async function curated(): Promise<string> {
    return await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: [
    "index",
    { title: "Guides", base: "guides", pages: [{ include: "**", pin: ["setup"] }] },
  ],
};`,
      "docs/index.mdx": page("Home"),
      "docs/guides/setup.mdx": page("Setup"),
      "docs/guides/advanced.mdx": page("Advanced"),
    });
  }

  it("prints the tree an include glob actually expands to", async () => {
    const { code, report } = await runJson(await curated());

    expect(code).toBe(0);
    expect(report.origin).toBe("explicit");
    expect(report.tree).toEqual([
      {
        title: "Guides",
        children: [
          {
            title: "Setup",
            urlPath: "/docs/guides/setup",
            children: [],
          },
          {
            title: "Advanced",
            urlPath: "/docs/guides/advanced",
            children: [],
          },
        ],
      },
    ]);
  });

  it("writes nothing — the project is unchanged afterwards", async () => {
    const dir = await curated();
    const before = (await readdir(dir, { recursive: true })).sort();

    await runJson(dir);

    expect((await readdir(dir, { recursive: true })).sort()).toEqual(before);
  });

  it("renders a readable tree by default", async () => {
    const capture = createCapture();
    const code = await runNavCommand(["--src", await curated()], capture.io);

    expect(code).toBe(0);
    expect(capture.stdout).toContain("Navigation (docs, explicit");
    expect(capture.stdout).toContain("Guides");
    expect(capture.stdout).toContain("/docs/guides/setup");
    expect(capture.stdout).toContain("No drift");
  });

  it("reports a derived tree as inferred", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};`,
      "docs/index.mdx": page("Home"),
      "docs/guides/setup.mdx": page("Setup"),
    });

    const { report } = await runJson(dir);
    expect(report.origin).toBe("inferred");
    expect(report.tree.map((node) => node.title)).toEqual(["Guides"]);
  });
});

describe("projects with no config", () => {
  it("infers a tree from disk instead of refusing", async () => {
    const dir = await fixture({
      "docs/index.mdx": page("Home"),
      "docs/guides/setup.mdx": page("Setup"),
    });

    const { code, report } = await runJson(dir);

    // `doctor` treats a missing config as a warning and keeps reporting, so
    // refusing here made one command reject a state the other supports.
    expect(code).toBe(0);
    expect(report.origin).toBe("inferred");
    expect(report.tree.map((node) => node.title)).toEqual(["Guides"]);
  });

  it("says what to do when there is no config and no docs directory", async () => {
    const capture = createCapture();
    const code = await runNavCommand(
      ["--src", await fixture({ "readme.md": "" })],
      capture.io
    );

    expect(code).toBe(1);
    expect(capture.stderr).toContain("leadtype init");
  });
});

describe("drift", () => {
  it("names pages no curated entry places", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: ["index"],
};`,
      "docs/index.mdx": page("Home"),
      "docs/stray.mdx": page("Stray"),
    });

    const { code, report } = await runJson(dir);

    // Drift is reported, not fatal — the pages still render.
    expect(code).toBe(0);
    expect(report.drift.unplaced).toEqual(["/docs/stray"]);
  });

  it("names a page two entries both claim", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: [
    { title: "One", base: "guides", pages: ["setup"] },
    { title: "Two", base: "guides", pages: [{ include: "**" }] },
  ],
};`,
      "docs/guides/setup.mdx": page("Setup"),
    });

    const { report } = await runJson(dir);
    expect(report.drift.duplicate).toEqual(["/docs/guides/setup"]);
  });

  it("names a page whose group the config never declares", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  groups: [{ slug: "known", title: "Known" }],
};`,
      "docs/index.mdx": `---\ntitle: "Home"\ngroup: nowhere\n---\n\nBody.\n`,
    });

    const { report } = await runJson(dir);
    expect(report.drift.unknownGroup).toEqual([
      { urlPath: "/docs", slug: "nowhere" },
    ]);
  });

  it("surfaces a pin that no longer matches, instead of resolving quietly", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  navigation: [
    { title: "Guides", base: "guides", pages: [{ include: "**", pin: ["renamed"] }] },
  ],
};`,
      "docs/guides/setup.mdx": page("Setup"),
    });

    const capture = createCapture();
    const code = await runNavCommand(["--src", dir], capture.io);

    expect(code).toBe(1);
    expect(capture.stderr).toContain('Nav pin "renamed"');
  });
});

describe("remote collections", () => {
  it("reads the synced checkout and reports inherited navigation", async () => {
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
      inheritConfig: true,
    },
  },
};`,
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

    const { code, report } = await runJson(dir);

    // A remote collection's `dir` is relative to its checkout, not the config
    // directory — resolving it as the latter finds an empty tree, and the
    // inherited navigation never shows up at all.
    expect(code).toBe(0);
    expect(report.origin).toBe("inherited");
    expect(report.pageCount).toBe(1);
    expect(report.tree.map((node) => node.title)).toEqual(["Guides"]);
  });

  it("says to sync when the checkout is missing", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: {
      repository: "https://github.com/acme/acme.git",
      cacheDir: ".leadtype/acme",
      dir: "docs",
      routePrefix: "/docs",
    },
  },
};`,
    });

    const capture = createCapture();
    const code = await runNavCommand(["--src", dir], capture.io);

    expect(code).toBe(1);
    expect(capture.stderr).toContain("leadtype sync");
  });
});

describe("multi-collection projects", () => {
  async function multi(): Promise<string> {
    return await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "content/docs", routePrefix: "/docs", navigation: ["index"] },
    changelog: {
      dir: "content/changelog",
      routePrefix: "/changelog",
      navigation: [{ title: "Releases", pages: [{ include: "**" }] }],
    },
  },
};`,
      "content/docs/index.mdx": page("Docs"),
      "content/changelog/1-0.mdx": page("1.0"),
    });
  }

  it("defaults to the first collection", async () => {
    const { report } = await runJson(await multi());
    expect(report.collection).toBe("docs");
  });

  it("inspects a named collection at its own route prefix", async () => {
    const { report } = await runJson(await multi(), [
      "--collection",
      "changelog",
    ]);

    expect(report.collection).toBe("changelog");
    expect(report.tree[0]?.children[0]?.urlPath).toBe("/changelog/1-0");
  });

  it("rejects an unknown collection, listing the real ones", async () => {
    const capture = createCapture();
    const code = await runNavCommand(
      ["--src", await multi(), "--collection", "nope"],
      capture.io
    );

    expect(code).toBe(2);
    expect(capture.stderr).toContain('unknown collection "nope"');
    expect(capture.stderr).toContain("docs, changelog");
  });
});
