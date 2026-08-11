import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DocsConfig } from "../llm";
import { writeSyncManifest } from "../sync/sync";
import { createDocsProject } from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-project-"));
  tempDirs.push(dir);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
  return dir;
}

function page(title: string): string {
  return `---\ntitle: "${title}"\ndescription: "About ${title}."\n---\n\n${title} body.\n`;
}

const product = { name: "Acme", tagline: "Acme does one useful thing." };

describe("single-source project", () => {
  const config: DocsConfig = {
    product,
    navigation: ["index", { title: "Guides", base: "guides", pages: ["auth"] }],
  };

  it("needs no content root, navigation, or mounts beyond the config", async () => {
    const dir = await fixture({
      "docs/index.mdx": page("Home"),
      "docs/guides/auth.mdx": page("Auth"),
    });

    const project = await createDocsProject({ config, configDir: dir });
    const pages = await project.listPages();

    expect(pages.map((entry) => entry.urlPath).sort()).toEqual([
      "/docs",
      "/docs/guides/auth",
    ]);
    expect(pages.every((entry) => entry.collection === "docs")).toBe(true);
  });

  it("satisfies the DocsSource contract adapters depend on", async () => {
    const dir = await fixture({ "docs/index.mdx": page("Home") });
    const project = await createDocsProject({ config, configDir: dir });

    // Adapters take `{ source }` structurally; a project must fit unchanged.
    for (const method of [
      "getNavigation",
      "listPages",
      "loadPage",
      "buildSearchIndex",
      "resolveInclude",
      "cleanup",
    ] as const) {
      expect(typeof project[method]).toBe("function");
    }
    expect(typeof project.contentDir).toBe("string");
  });

  it("loads a page by slug with its collection", async () => {
    const dir = await fixture({
      "docs/index.mdx": page("Home"),
      "docs/guides/auth.mdx": page("Auth"),
    });
    const project = await createDocsProject({ config, configDir: dir });

    const loaded = await project.loadPage("guides/auth");
    expect(loaded?.title).toBe("Auth");
    expect(loaded?.collection).toBe("docs");
    expect(loaded?.markdown).toContain("Auth body.");
    expect(await project.loadPage("nope")).toBeNull();
  });

  it("uses the config's navigation for the resolved tree", async () => {
    const dir = await fixture({
      "docs/index.mdx": page("Home"),
      "docs/guides/auth.mdx": page("Auth"),
    });
    const project = await createDocsProject({ config, configDir: dir });

    const navigation = await project.getNavigation();
    expect(navigation.groups.map((group) => group.title)).toEqual(["Guides"]);
  });
});

describe("multi-collection project", () => {
  const config: DocsConfig = {
    product,
    collections: {
      docs: { dir: "content/docs", routePrefix: "/docs" },
      changelog: { dir: "content/changelog", routePrefix: "/changelog" },
    },
  };

  async function multiFixture(): Promise<string> {
    return await fixture({
      "content/docs/index.mdx": page("Docs"),
      "content/docs/auth.mdx": page("Auth"),
      "content/changelog/1-0.mdx": page("1.0"),
    });
  }

  it("merges collections into one route-aware page list with provenance", async () => {
    const project = await createDocsProject({
      config,
      configDir: await multiFixture(),
    });

    const pages = await project.listPages();
    expect(
      pages.map((entry) => [entry.urlPath, entry.collection]).sort()
    ).toEqual([
      ["/changelog/1-0", "changelog"],
      ["/docs", "docs"],
      ["/docs/auth", "docs"],
    ]);
  });

  it("loads a page from any collection without a per-collection map", async () => {
    const project = await createDocsProject({
      config,
      configDir: await multiFixture(),
    });

    const release = await project.loadPage("changelog/1-0");
    expect(release?.collection).toBe("changelog");
    expect(release?.markdown).toContain("1.0 body.");

    const doc = await project.loadPage("auth");
    expect(doc?.collection).toBe("docs");
  });

  it("honours a collection's exclude at runtime, not just at build time", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    docs: { dir: "content/docs", routePrefix: "/docs", exclude: ["drafts/**"] },
  },
};`,
      "content/docs/index.mdx": page("Docs"),
      "content/docs/drafts/secret.mdx": page("Unpublished"),
    });

    const project = await createDocsProject({ configDir: dir });

    // `exclude` is a page-existence filter. Honouring it while generating but
    // not while serving publishes exactly the content it was meant to withhold.
    expect((await project.listPages()).map((entry) => entry.urlPath)).toEqual([
      "/docs",
    ]);
    expect(await project.loadPage("drafts/secret")).toBeNull();
  });

  it("refuses an ambiguous collection-local slug instead of guessing", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: {
    guides: { dir: "content/guides", routePrefix: "/guides" },
    reference: { dir: "content/reference", routePrefix: "/reference" },
  },
};`,
      "content/guides/overview.mdx": page("Guides overview"),
      "content/reference/overview.mdx": page("Reference overview"),
    });

    const project = await createDocsProject({ configDir: dir });

    // Route paths stay unambiguous and keep working.
    expect((await project.loadPage("guides/overview"))?.collection).toBe(
      "guides"
    );
    expect((await project.loadPage("reference/overview"))?.collection).toBe(
      "reference"
    );

    // The bare slug exists in both. Returning the first-declared one silently
    // would serve the wrong page through an adapter's static params.
    await expect(project.loadPage("overview")).rejects.toThrow(
      /slug "overview" is ambiguous.*"guides" and "reference"/s
    );
  });

  it("applies site-wide mounts alongside a collection's own", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  mounts: [{ pathPrefix: "legal", urlPrefix: "/legal" }],
  collections: { docs: { dir: "content/docs", routePrefix: "/docs" } },
};`,
      "content/docs/index.mdx": page("Docs"),
      "content/docs/legal/terms.mdx": page("Terms"),
    });

    const project = await createDocsProject({ configDir: dir });

    // Top-level `mounts` remap URLs in the generated artifacts, so dropping
    // them here would render a different route than the sitemap advertises.
    expect(
      (await project.listPages()).map((entry) => entry.urlPath).sort()
    ).toEqual(["/docs", "/legal/terms"]);
  });

  it("resolves site-wide mounts against the merged tree, as generation does", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  mounts: [
    { pathPrefix: "legal", urlPrefix: "/legal" },
    { pathPrefix: "guides/archive", urlPrefix: "/archive" },
  ],
  collections: {
    docs: { dir: "content/docs", routePrefix: "/docs" },
    guides: { dir: "content/guides", routePrefix: "/guides" },
  },
};`,
      "content/docs/index.mdx": page("Docs"),
      "content/docs/legal/terms.mdx": page("Terms"),
      "content/guides/index.mdx": page("Guides"),
      "content/guides/legal/refund.mdx": page("Refund"),
      "content/guides/archive/old.mdx": page("Old"),
    });

    const project = await createDocsProject({ configDir: dir });

    // Generation resolves site-wide mounts once, against the merged staged
    // tree, where guides files sit under `guides/` — so `legal` reaches only
    // the default collection, while `guides/archive` reaches into the guides
    // collection. Re-anchoring `legal` per collection would serve
    // `/legal/refund` here while the sitemap advertises `/guides/legal/refund`.
    expect(
      (await project.listPages()).map((entry) => entry.urlPath).sort()
    ).toEqual([
      "/archive/old",
      "/docs",
      "/guides",
      "/guides/legal/refund",
      "/legal/terms",
    ]);
  });

  it("refuses openapi alongside collections rather than dropping the pages", async () => {
    const dir = await fixture({
      "leadtype.config.ts": `export default {
  product: { name: "Acme", tagline: "Acme docs." },
  collections: { docs: { dir: "content/docs", routePrefix: "/docs" } },
  openapi: { input: "./api.yaml", output: "api" },
};`,
      "content/docs/index.mdx": page("Docs"),
    });

    // Generation emits API pages regardless, so silently skipping them here
    // leaves the site serving fewer routes than its own sitemap advertises.
    await expect(createDocsProject({ configDir: dir })).rejects.toThrow(
      /`openapi` is not yet supported alongside `collections`/
    );
  });

  it("exposes the resolved collections and acquisition graph", async () => {
    const project = await createDocsProject({
      config,
      configDir: await multiFixture(),
    });

    expect(project.collections.map((entry) => entry.key)).toEqual([
      "docs",
      "changelog",
    ]);
    expect(project.sources).toEqual([
      { id: "local", kind: "local", collectionKeys: ["docs", "changelog"] },
    ]);
  });

  it("hands back one collection's source for a custom integration", async () => {
    const project = await createDocsProject({
      config,
      configDir: await multiFixture(),
    });

    const changelog = project.getSource("changelog");
    expect((await changelog.listPages()).map((entry) => entry.urlPath)).toEqual(
      ["/changelog/1-0"]
    );
    expect(() => project.getSource("nope")).toThrow(
      /unknown collection "nope"/
    );
  });

  it("indexes every collection for search", async () => {
    const project = await createDocsProject({
      config,
      configDir: await multiFixture(),
    });

    const bundle = await project.buildSearchIndex();

    // Document entries are positional tuples; index 3 is `urlPath`.
    const URL_PATH = 3;
    expect(
      bundle.index.documents.map((entry) => entry[URL_PATH]).sort()
    ).toEqual(["/changelog/1-0", "/docs", "/docs/auth"]);

    // One inverted index over every collection, not two concatenated ones.
    // Chunk entries reference documents positionally, so concatenating two
    // finished indexes leaves the second one's chunks pointing at the first
    // one's documents — or past the end. A count assertion cannot see that;
    // resolving every reference can.
    const CHUNK_DOCUMENT_INDEX = 1;
    const referenced = new Set(
      bundle.index.chunks.map((chunk) => chunk[CHUNK_DOCUMENT_INDEX])
    );
    for (const index of referenced) {
      expect(bundle.index.documents[index]).toBeDefined();
    }
    // And every collection's pages are reachable, not just the first's.
    expect(referenced.size).toBe(bundle.index.documents.length);
  });

  it("rejects colliding route prefixes before any content is read", async () => {
    const dir = await fixture({
      "content/a/index.mdx": page("A"),
      "content/b/index.mdx": page("B"),
    });

    await expect(
      createDocsProject({
        config: {
          product,
          collections: {
            a: { dir: "content/a", routePrefix: "/docs" },
            b: { dir: "content/b", routePrefix: "/docs/" },
          },
        },
        configDir: dir,
      })
    ).rejects.toThrow(/collections "a" and "b" share routePrefix "\/docs"/);
  });

  it("reports a mount-induced route collision naming both collections", async () => {
    // Distinct prefixes, so normalization passes — but a mount lands one
    // collection's page on the other's route, which only shows up once pages
    // are enumerated.
    const dir = await fixture({
      "content/a/index.mdx": page("A"),
      "content/b/shared/index.mdx": page("B"),
    });
    const project = await createDocsProject({
      config: {
        product,
        collections: {
          a: { dir: "content/a", routePrefix: "/docs" },
          b: {
            dir: "content/b",
            routePrefix: "/other",
            mounts: [{ pathPrefix: "shared", urlPrefix: "/docs" }],
          },
        },
      },
      configDir: dir,
    });

    await expect(project.listPages()).rejects.toThrow(
      /collections "a" and "b" both resolve "\/docs"/
    );
  });

  it("fails with the offending path when a collection dir is missing", async () => {
    const dir = await fixture({ "content/docs/index.mdx": page("Docs") });
    await expect(
      createDocsProject({
        config: {
          product,
          collections: {
            docs: { dir: "content/missing", routePrefix: "/docs" },
          },
        },
        configDir: dir,
      })
    ).rejects.toThrow(
      /collection "docs" points at .*content\/missing.*does not exist/s
    );
  });
});

describe("remote collections are cache-only", () => {
  const remoteConfig: DocsConfig = {
    product,
    collections: {
      docs: {
        repository: "https://github.com/acme/acme.git",
        ref: "main",
        cacheDir: ".leadtype/acme",
        dir: "docs",
        routePrefix: "/docs",
      },
    },
  };

  it("tells you to sync instead of cloning during a request", async () => {
    const dir = await fixture({ "placeholder.txt": "" });
    await expect(
      createDocsProject({ config: remoteConfig, configDir: dir })
    ).rejects.toThrow(/no checkout at.*leadtype sync.*never clones/s);
  });

  it("rejects a cache holding a different revision than the config asks for", async () => {
    const dir = await fixture({
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

    await expect(
      createDocsProject({ config: remoteConfig, configDir: dir })
    ).rejects.toThrow(
      /holds https:\/\/github.com\/acme\/acme.git@v0\.9.*asks for.*@main/s
    );
  });

  it("reads a matching cache without touching the network", async () => {
    const dir = await fixture({
      ".leadtype/acme/.git/HEAD": "ref: refs/heads/main\n",
      ".leadtype/acme/docs/index.mdx": page("Cached"),
    });
    await writeSyncManifest(path.join(dir, ".leadtype/acme"), {
      version: 1,
      repository: "https://github.com/acme/acme.git",
      ref: "main",
      commit: "abc1234",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });

    const project = await createDocsProject({
      config: remoteConfig,
      configDir: dir,
    });
    expect((await project.listPages()).map((entry) => entry.urlPath)).toEqual([
      "/docs",
    ]);
  });
});
