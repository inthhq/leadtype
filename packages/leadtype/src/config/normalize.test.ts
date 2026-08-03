import { describe, expect, it } from "vitest";
import { type DocsConfig, gitSource } from "../llm/llm";
import { formatDeprecationWarning, normalizeDocsConfig } from "./normalize";
import { serializeResolvedConfig } from "./types";

const product = { name: "Acme", tagline: "Acme does one useful thing." };
const CONFIG_PATH = "/repo/leadtype.config.ts";

function normalize(config: DocsConfig) {
  return normalizeDocsConfig(config, { configPath: CONFIG_PATH });
}

describe("canonical and legacy configs resolve identically", () => {
  const canonical: DocsConfig = {
    product,
    collections: {
      docs: {
        repository: "https://github.com/acme/acme.git",
        ref: "main",
        dir: "docs",
        routePrefix: "/docs",
        inheritConfig: true,
      },
      changelog: {
        repository: "https://github.com/acme/acme.git",
        ref: "main",
        dir: "changelog",
        routePrefix: "/releases",
      },
    },
  };

  const legacy: DocsConfig = {
    product,
    collections: {
      docs: {
        repository: "https://github.com/acme/acme.git",
        ref: "main",
        dir: "docs",
        prefix: "/docs",
        sourceConfig: true,
      },
      changelog: {
        repository: "https://github.com/acme/acme.git",
        ref: "main",
        dir: "changelog",
        // Deliberately unlike the collection key: with `/changelog` the
        // `/${key}` fallback produces the same answer, so the assertion below
        // would pass even if the alias fold were deleted entirely.
        prefix: "/releases",
      },
    },
  };

  it("produces the same collections and sources", () => {
    const fromCanonical = normalize(canonical).resolved;
    const fromLegacy = normalize(legacy).resolved;

    // Provenance intentionally differs — it records that the legacy config
    // authored these fields under their old names — so compare everything else.
    const strip = (resolved: typeof fromCanonical) => ({
      mode: resolved.mode,
      sources: resolved.sources,
      collections: resolved.collections.map(
        ({ provenance: _provenance, ...rest }) => rest
      ),
    });

    expect(strip(fromLegacy)).toEqual(strip(fromCanonical));
  });

  it("rewrites the legacy config to canonical field names", () => {
    const { config } = normalize(legacy);
    expect(config.collections?.docs).toMatchObject({
      routePrefix: "/docs",
      inheritConfig: true,
    });
    expect(config.collections?.docs).not.toHaveProperty("prefix");
    expect(config.collections?.docs).not.toHaveProperty("sourceConfig");
  });

  it("records the deprecated fields it folded, with stable ids", () => {
    const { resolved } = normalize(legacy);
    expect(resolved.deprecations).toEqual([
      {
        id: "collection.prefix",
        field: "collections.docs.prefix",
        replacement: "collections.docs.routePrefix",
        message: expect.stringContaining("rename it to routePrefix"),
      },
      {
        id: "collection.sourceConfig",
        field: "collections.docs.sourceConfig",
        replacement: "collections.docs.inheritConfig",
        message: expect.stringContaining("rename it to inheritConfig"),
      },
      {
        id: "collection.prefix",
        field: "collections.changelog.prefix",
        replacement: "collections.changelog.routePrefix",
        message: expect.stringContaining("rename it to routePrefix"),
      },
    ]);
  });

  it("reports nothing for a fully canonical config", () => {
    expect(normalize(canonical).resolved.deprecations).toEqual([]);
  });
});

describe("ambiguous old-plus-new combinations", () => {
  it("rejects prefix alongside routePrefix, naming both and the winner", () => {
    expect(() =>
      normalize({
        product,
        collections: {
          docs: { dir: "docs", prefix: "/a", routePrefix: "/b" },
        },
      })
    ).toThrow(
      /collection "docs" sets both "prefix" and "routePrefix".*"routePrefix" is the canonical field/s
    );
  });

  it("rejects sourceConfig alongside inheritConfig", () => {
    expect(() =>
      normalize({
        product,
        collections: {
          docs: {
            dir: "docs",
            repository: "https://example.com/a.git",
            sourceConfig: true,
            inheritConfig: true,
          },
        },
      })
    ).toThrow(/sets both "sourceConfig" and "inheritConfig"/);
  });

  it("rejects schema alongside frontmatterSchema", () => {
    const schema = {} as never;
    expect(() =>
      normalize({
        product,
        collections: {
          docs: { dir: "docs", schema, frontmatterSchema: schema },
        },
      })
    ).toThrow(/sets both "schema" and "frontmatterSchema"/);
  });
});

describe("source graph", () => {
  it("dedupes collections that share a repository and ref", () => {
    const { resolved } = normalize({
      product,
      collections: {
        docs: {
          repository: "https://github.com/acme/acme.git",
          dir: "docs",
          routePrefix: "/docs",
        },
        changelog: {
          repository: "https://github.com/acme/acme.git",
          dir: "changelog",
          routePrefix: "/changelog",
        },
      },
    });

    expect(resolved.sources).toHaveLength(1);
    expect(resolved.sources[0]).toMatchObject({
      kind: "git",
      repository: "https://github.com/acme/acme.git",
      ref: "main",
      collectionKeys: ["docs", "changelog"],
    });
    expect(
      resolved.collections.map((collection) => collection.sourceId)
    ).toEqual([resolved.sources[0].id, resolved.sources[0].id]);
  });

  it("keeps different refs of one repository as separate acquisitions", () => {
    const { resolved } = normalize({
      product,
      collections: {
        stable: {
          repository: "https://github.com/acme/acme.git",
          ref: "v1",
          dir: "docs",
          routePrefix: "/docs",
        },
        next: {
          repository: "https://github.com/acme/acme.git",
          ref: "main",
          dir: "docs",
          routePrefix: "/next",
        },
      },
    });
    expect(resolved.sources).toHaveLength(2);
  });

  it("marks a SHA ref as pinned and a branch as mutable", () => {
    const { resolved } = normalize({
      product,
      collections: {
        pinned: {
          repository: "https://github.com/acme/acme.git",
          ref: "0123456789abcdef0123456789abcdef01234567",
          dir: "docs",
          routePrefix: "/docs",
        },
        moving: {
          repository: "https://github.com/acme/other.git",
          ref: "main",
          dir: "docs",
          routePrefix: "/other",
        },
      },
    });
    const kinds = Object.fromEntries(
      resolved.sources.flatMap((source) =>
        source.kind === "git"
          ? [[source.collectionKeys[0], source.refKind]]
          : []
      )
    );
    expect(kinds).toEqual({ pinned: "commit", moving: "mutable" });
  });

  it("rejects conflicting cacheDir values for one acquisition", () => {
    expect(() =>
      normalize({
        product,
        collections: {
          docs: {
            repository: "https://github.com/acme/acme.git",
            dir: "docs",
            routePrefix: "/docs",
            cacheDir: ".leadtype/a",
          },
          changelog: {
            repository: "https://github.com/acme/acme.git",
            dir: "changelog",
            routePrefix: "/changelog",
            cacheDir: ".leadtype/b",
          },
        },
      })
    ).toThrow(/different cacheDir values/);
  });

  it("groups every local collection under one local source", () => {
    const { resolved } = normalize({
      product,
      collections: {
        docs: { dir: "docs", routePrefix: "/docs" },
        guides: { dir: "guides", routePrefix: "/guides" },
      },
    });
    expect(resolved.sources).toEqual([
      { id: "local", kind: "local", collectionKeys: ["docs", "guides"] },
    ]);
  });
});

describe("git source groups", () => {
  const grouped: DocsConfig = {
    product,
    sources: {
      c15t: gitSource({
        repository: "https://github.com/c15t/c15t.git",
        ref: "main",
        cacheDir: ".leadtype/c15t",
        inheritConfig: true,
        collections: {
          docs: { dir: "docs", routePrefix: "/docs" },
          changelog: { dir: "changelog", routePrefix: "/changelog" },
        },
      }),
    },
  };

  const flat: DocsConfig = {
    product,
    collections: {
      docs: {
        repository: "https://github.com/c15t/c15t.git",
        ref: "main",
        cacheDir: ".leadtype/c15t",
        dir: "docs",
        routePrefix: "/docs",
        inheritConfig: true,
      },
      changelog: {
        repository: "https://github.com/c15t/c15t.git",
        ref: "main",
        cacheDir: ".leadtype/c15t",
        dir: "changelog",
        routePrefix: "/changelog",
        inheritConfig: true,
      },
    },
  };

  it("resolves to the same collections as the equivalent flat config", () => {
    const fromGroup = normalize(grouped).resolved;
    const fromFlat = normalize(flat).resolved;

    // `sourceId` is the one intended difference: a named source keeps its
    // authored id, an anonymous one is identified by repository@ref. Both
    // still resolve to exactly one shared acquisition.
    const strip = (resolved: typeof fromGroup) =>
      resolved.collections.map(({ sourceId: _sourceId, ...rest }) => rest);

    expect(strip(fromGroup)).toEqual(strip(fromFlat));
    expect(fromGroup.sources).toHaveLength(1);
    expect(fromFlat.sources).toHaveLength(1);
  });

  it("performs one acquisition for both collections", () => {
    const { resolved } = normalize(grouped);
    expect(resolved.sources).toHaveLength(1);
    expect(resolved.sources[0]).toMatchObject({
      kind: "git",
      repository: "https://github.com/c15t/c15t.git",
      ref: "main",
      cacheDir: ".leadtype/c15t",
      collectionKeys: ["docs", "changelog"],
    });
  });

  it("names the resolved source after the authored source id", () => {
    const { resolved } = normalize(grouped);
    expect(resolved.sources[0].id).toBe("c15t");
    expect(
      resolved.collections.map((collection) => collection.sourceId)
    ).toEqual(["c15t", "c15t"]);
  });

  it("cascades acquisition and inheritance onto every child", () => {
    const { config } = normalize(grouped);
    expect(config.collections?.changelog).toMatchObject({
      repository: "https://github.com/c15t/c15t.git",
      ref: "main",
      cacheDir: ".leadtype/c15t",
      inheritConfig: true,
    });
    // The expanded flat map is the canonical form; `sources` does not survive
    // normalization, so nothing downstream can read the project twice.
    expect(config).not.toHaveProperty("sources");
  });

  it("lets a child opt out of the source's inheritance policy", () => {
    const { config } = normalize({
      product,
      sources: {
        c15t: gitSource({
          repository: "https://github.com/c15t/c15t.git",
          inheritConfig: true,
          collections: {
            docs: { dir: "docs", routePrefix: "/docs" },
            changelog: {
              dir: "changelog",
              routePrefix: "/changelog",
              inheritConfig: false,
            },
          },
        }),
      },
    });
    expect(config.collections?.docs.inheritConfig).toBe(true);
    expect(config.collections?.changelog.inheritConfig).toBe(false);
  });

  it("supports a source group and a flat collection side by side", () => {
    const { resolved } = normalize({
      product,
      collections: { local: { dir: "docs", routePrefix: "/local" } },
      sources: {
        remote: gitSource({
          repository: "https://github.com/acme/acme.git",
          collections: { guides: { dir: "docs", routePrefix: "/guides" } },
        }),
      },
    });
    expect(resolved.sources.map((source) => source.id)).toEqual([
      "local",
      "remote",
    ]);
  });

  it("rejects a collection id claimed by two sources", () => {
    expect(() =>
      normalize({
        product,
        sources: {
          a: gitSource({
            repository: "https://github.com/acme/a.git",
            collections: { docs: { dir: "docs", routePrefix: "/a" } },
          }),
          b: gitSource({
            repository: "https://github.com/acme/b.git",
            collections: { docs: { dir: "docs", routePrefix: "/b" } },
          }),
        },
      })
    ).toThrow(
      /collection id "docs" is declared by both source "a" and source "b"/
    );
  });

  it("rejects a collection id claimed by both a source and the flat map", () => {
    expect(() =>
      normalize({
        product,
        collections: { docs: { dir: "docs", routePrefix: "/docs" } },
        sources: {
          remote: gitSource({
            repository: "https://github.com/acme/a.git",
            collections: { docs: { dir: "docs", routePrefix: "/remote" } },
          }),
        },
      })
    ).toThrow(/declared by both "collections" and source "remote"/);
  });

  it("rejects two named sources that are the same acquisition", () => {
    expect(() =>
      normalize({
        product,
        sources: {
          docsRepo: gitSource({
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            collections: { docs: { dir: "docs", routePrefix: "/docs" } },
          }),
          changelogRepo: gitSource({
            repository: "https://github.com/acme/acme.git",
            ref: "main",
            collections: {
              changelog: { dir: "changelog", routePrefix: "/changelog" },
            },
          }),
        },
      })
    ).toThrow(/both target https:\/\/github.com\/acme\/acme.git@main/);
  });

  it("rejects a source with no collections", () => {
    expect(() =>
      normalize({
        product,
        sources: {
          empty: gitSource({
            repository: "https://github.com/acme/acme.git",
            collections: {},
          }),
        },
      })
    ).toThrow(/source "empty" declares no collections/);
  });
});

describe("route prefixes", () => {
  it("defaults to the collection key and records that as inferred", () => {
    const { resolved } = normalize({
      product,
      collections: { guides: { dir: "guides" } },
    });
    expect(resolved.collections[0].routePrefix).toBe("/guides");
    expect(resolved.collections[0].provenance.routePrefix).toMatchObject({
      origin: "inferred",
      inferredFrom: "collection key",
    });
  });

  it("records an authored alias as explicit, naming the field it came from", () => {
    const { resolved } = normalize({
      product,
      collections: { guides: { dir: "guides", prefix: "/handbook" } },
    });
    expect(resolved.collections[0].routePrefix).toBe("/handbook");
    expect(resolved.collections[0].provenance.routePrefix).toMatchObject({
      origin: "explicit",
      authoredAs: "prefix",
      configPath: CONFIG_PATH,
    });
  });

  it("rejects two collections sharing a prefix", () => {
    expect(() =>
      normalize({
        product,
        collections: {
          docs: { dir: "docs", routePrefix: "/docs" },
          guides: { dir: "guides", routePrefix: "/docs" },
        },
      })
    ).toThrow(/share routePrefix "\/docs"/);
  });

  it("rejects the site root as a collection prefix", () => {
    expect(() =>
      normalize({
        product,
        collections: { docs: { dir: "docs", routePrefix: "/" } },
      })
    ).toThrow(/must not be the site root/);
  });
});

describe("single-source projects", () => {
  const single: DocsConfig = {
    product,
    navigation: ["index", "quickstart"],
    mounts: [{ pathPrefix: "changelog", urlPrefix: "/changelog" }],
  };

  it("resolves to one collection so downstream code has one shape", () => {
    const { resolved } = normalize(single);
    expect(resolved.mode).toBe("single-source");
    expect(resolved.collections).toHaveLength(1);
    expect(resolved.collections[0]).toMatchObject({
      key: "docs",
      routePrefix: "/docs",
      sourceId: "local",
      navigation: ["index", "quickstart"],
    });
  });

  it("leaves dir unset, because the host supplies the content root", () => {
    const { resolved } = normalize(single);
    expect(resolved.collections[0].dir).toBeUndefined();
    expect(resolved.collections[0].provenance.dir).toMatchObject({
      origin: "default",
    });
  });

  it("records explicitly authored top-level fields", () => {
    const { resolved } = normalize(single);
    expect(resolved.provenance.navigation).toMatchObject({
      origin: "explicit",
      configPath: CONFIG_PATH,
    });
    expect(resolved.provenance.collections).toBeUndefined();
  });
});

describe("serializeResolvedConfig", () => {
  it("survives a JSON round trip and flags non-serializable fields", () => {
    const { resolved } = normalize({
      product,
      collections: {
        docs: {
          dir: "docs",
          routePrefix: "/docs",
          frontmatterSchema: {} as never,
          navigation: ["index"],
        },
      },
    });

    const serialized = serializeResolvedConfig(resolved);
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
    expect(serialized.collections[0]).toMatchObject({
      hasFrontmatterSchema: true,
      hasNavigation: true,
      hasGroups: false,
    });
  });
});

describe("formatDeprecationWarning", () => {
  it("returns null when nothing is deprecated", () => {
    expect(formatDeprecationWarning([])).toBeNull();
  });

  it("lists every rename in one message", () => {
    const warning = formatDeprecationWarning([
      {
        id: "collection.prefix",
        field: "collections.docs.prefix",
        replacement: "collections.docs.routePrefix",
        message: "…",
      },
      {
        id: "collection.schema",
        field: "collections.docs.schema",
        replacement: "collections.docs.frontmatterSchema",
        message: "…",
      },
    ]);
    expect(warning?.message).toContain("2 deprecated fields");
    expect(warning?.message).toContain(
      "collections.docs.prefix → collections.docs.routePrefix"
    );
    expect(warning?.message).toContain(
      "collections.docs.schema → collections.docs.frontmatterSchema"
    );
    expect(warning?.hint).toMatch(/next major release/);
  });
});
