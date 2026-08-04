import { describe, expect, it } from "vitest";
import type { DocsSource } from "../source";
import type { FumadocsSourceConfig } from "./index";

// A stand-in that satisfies the contract; nothing here calls it.
const project = {
  contentDir: "/tmp/docs",
  getNavigation: () => Promise.resolve({}),
  listPages: () => Promise.resolve([]),
  loadPage: () => Promise.resolve(null),
  buildSearchIndex: () => Promise.resolve({}),
  resolveInclude: () => Promise.resolve({}),
  cleanup: () => Promise.resolve(),
} as unknown as DocsSource;

describe("FumadocsSourceConfig", () => {
  it("accepts each arm on its own", () => {
    const withProject: FumadocsSourceConfig = { source: project };
    const withOptions: FumadocsSourceConfig = {
      source: project,
      includeMetaJson: false,
    };
    const withDescription: FumadocsSourceConfig = {
      contentDir: "./docs",
      nav: [],
    };
    expect([withProject, withOptions, withDescription]).toHaveLength(3);
  });

  it("rejects a project mixed with source-description options", () => {
    // A plain union relaxes excess-property checking across members, so this
    // compiled and silently dropped `typeTableBasePath` — the quiet config
    // drift that passing a project exists to end.
    const mixed: FumadocsSourceConfig = {
      source: project,
      // @ts-expect-error must not compile alongside `source`
      typeTableBasePath: "/x",
    };
    expect(mixed).toBeDefined();
  });
});
