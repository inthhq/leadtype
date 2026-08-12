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

  it("does not count or flag pages the collection excludes", async () => {
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

    const { code, report } = await runJson(dir);

    // `generate` stages a filtered mirror before resolving navigation, so an
    // excluded page is neither shipped nor unplaced — counting it here
    // reported drift the build cannot produce.
    expect(code).toBe(0);
    expect(report.pageCount).toBe(1);
    expect(report.drift.unplaced).toEqual([]);
  });

  it("counts a dot-directory page in a filtered collection", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "docs", routePrefix: "/docs", exclude: ["drafts/**"], navigation: ["index"] },
  },
};`,
      "docs/index.mdx": page("Home"),
      "docs/.well-known/security.mdx": page("Security"),
    });

    const { code, report } = await runJson(dir);

    // Staging globs with `dot: true` (`copySourceFiles`), so `generate` ships
    // the page under `.well-known/`. The admitted-set glob ran on tinyglobby's
    // default `dot: false`, so any unrelated filter dropped the page from the
    // count and excused it from drift — a false negative on a shipped page.
    expect(code).toBe(0);
    expect(report.pageCount).toBe(2);
    expect(report.drift.unplaced).toEqual(["/docs/.well-known/security"]);
  });

  it("keeps a bare-directory include literal, as staging does", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "docs", routePrefix: "/docs", include: ["guides"] },
  },
};`,
      "docs/guides/intro.mdx": page("Intro"),
    });

    const { code, report } = await runJson(dir);

    // `copySourceFiles` disables tinyglobby's directory expansion, so a bare
    // `guides` matches only a *file* named `guides` and `generate` stages
    // nothing. Expanding it to `guides/**` here counted pages the build never
    // ships.
    expect(code).toBe(0);
    expect(report.pageCount).toBe(0);
  });

  it("excludes a bare-directory entry's contents, as staging does", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "docs", routePrefix: "/docs", exclude: ["drafts"], navigation: ["index"] },
  },
};`,
      "docs/index.mdx": page("Home"),
      "docs/drafts/intro.mdx": page("Intro"),
    });

    const { code, report } = await runJson(dir);

    // Unlike includes, a bare-directory `ignore` entry prunes the directory
    // it names whether or not expansion is on — tinyglobby skips crawling
    // into an ignored directory. `copySourceFiles` behaves the same way, so
    // the page is neither staged nor counted here.
    expect(code).toBe(0);
    expect(report.pageCount).toBe(1);
    expect(report.drift.unplaced).toEqual([]);
  });

  it("does not report the root pages of an inferred tree as drift", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
};`,
      "docs/index.mdx": page("Home"),
      "docs/guides/setup.mdx": page("Setup"),
    });

    const { code, report } = await runJson(dir);

    // A derived tree places everything by construction — its root pages are
    // placements, not drift. Reporting them made every inferred project name
    // its own index page as unplaced.
    expect(code).toBe(0);
    expect(report.origin).toBe("inferred");
    expect(report.drift.unplaced).toEqual([]);
  });

  it("accepts a group declared by a sibling collection", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "content/docs", routePrefix: "/docs", groups: [{ slug: "ref", title: "Reference" }] },
    guides: { dir: "content/guides", routePrefix: "/guides", groups: [{ slug: "howto", title: "How-to" }] },
  },
};`,
      "content/docs/api.mdx": `---\ntitle: "API"\ndescription: "API."\ngroup: ref\n---\n\nBody.\n`,
      "content/guides/deploy.mdx": `---\ntitle: "Deploy"\ndescription: "Deploy."\ngroup: ref\n---\n\nBody.\n`,
    });

    const { report } = await runJson(dir, ["--collection", "guides"]);

    // `generate` merges every collection's groups before resolving, so a page
    // whose `group:` a sibling collection declares resolves there — reading
    // only this collection's groups reported it as unknown.
    expect(report.drift.unknownGroup).toEqual([]);
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

  it("fails when curated navigation names a page the collection excludes", async () => {
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

    const capture = createCapture();
    const code = await runNavCommand(["--src", dir], capture.io);

    // `generate` stages the filtered mirror before resolving, so this
    // reference fails the build as missing — resolving against the raw
    // directory reported the same project as fine here.
    expect(code).toBe(1);
    expect(capture.stderr).toContain('Nav page "drafts/wip"');
  });
});

describe("i18n projects", () => {
  it("resolves literal nav entries when the default locale lives under its own directory", async () => {
    const dir = await fixture({
      "docs/docs.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  i18n: { defaultLocale: "en", locales: ["en", "zh"] },
  navigation: ["index"],
};`,
      "docs/en/index.mdx": page("Home"),
      "docs/zh/index.mdx": page("Home (zh)"),
    });

    const { code, report } = await runJson(dir);

    // Without i18n forwarded, "index" matches no file — the default locale's
    // page lives at "en/index" — and every i18n project exited 1 with
    // 'Nav page "index" under "root" did not match a documentation page'.
    expect(code).toBe(0);
    expect(report.pageCount).toBe(1);
    expect(report.drift.unplaced).toEqual([]);
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

  it("fails on a blocking diagnostic even when the content directory resolves", async () => {
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
      // The checkout is perfectly readable; only the source config is broken.
      ".leadtype/acme/docs/docs.config.ts": "export default {{{",
      ".leadtype/acme/docs/guides/auth.mdx": page("Auth"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/acme"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      commit: "abcdef1",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });

    const capture = createCapture();
    const code = await runNavCommand(["--src", dir], capture.io);

    // `source.inherit-failed` is independent of the content directory, so
    // checking diagnostics only when that directory was missing printed a
    // fallback tree — precisely the wrong one — as `{ ok: true }`, while
    // `doctor` and `createDocsProject` both failed on the same project.
    expect(code).toBe(1);
    expect(capture.stderr).toContain("inheritConfig");
    expect(capture.stderr).toContain("leadtype sync");
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
