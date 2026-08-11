import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadLeadtypeConfig } from "../config/load";
import {
  type ResolvedProject,
  resolveProject,
  resolveProjectFromLoaded,
} from "../config/project";
import { syncSources, writeSyncManifest } from "../sync/sync";
import { runGenerateCommand } from "./generate";

// Fixture configs import from source so they exercise the working tree.
const LEADTYPE_ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-generate-"));
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

function createCapture(): {
  io: {
    stderr: { write(chunk: string): boolean };
    stdout: { write(chunk: string): boolean };
  };
  stderr(): string;
  stdout(): string;
} {
  let stderrText = "";
  let stdoutText = "";
  return {
    io: {
      stderr: {
        write(chunk: string) {
          stderrText += chunk;
          return true;
        },
      },
      stdout: {
        write(chunk: string) {
          stdoutText += chunk;
          return true;
        },
      },
    },
    stderr: () => stderrText,
    stdout: () => stdoutText,
  };
}

const IDENTITY = 'product: { name: "Acme", tagline: "Acme docs." }';

/**
 * One project exercising everything the resolved view carries: a named git
 * source with inherited navigation, a local collection authored with a
 * deprecated alias, and content in both.
 */
async function sharedFixture(): Promise<string> {
  const dir = await fixture({
    "leadtype.config.ts": `import { gitSource } from "LEADTYPE_ENTRY";

export default {
  ${IDENTITY},
  sources: {
    upstream: gitSource({
      repository: "https://github.com/acme/acme.git",
      ref: "abcdef1234567",
      cacheDir: ".leadtype/acme",
      collections: {
        guides: { dir: "docs", routePrefix: "/docs", inheritConfig: true },
      },
    }),
  },
  collections: {
    changelog: { dir: "changelog", prefix: "/changelog" },
  },
};`.replace("LEADTYPE_ENTRY", LEADTYPE_ENTRY),
    ".leadtype/acme/.git/HEAD": "ref: refs/heads/main\n",
    ".leadtype/acme/docs/docs.config.ts": `export default { navigation: ["index"] };`,
    ".leadtype/acme/docs/index.mdx": page("Guides"),
    "changelog/v1.mdx": page("V1"),
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

/** The fields both subsystems must agree on, in comparable form. */
function view(project: ResolvedProject) {
  return {
    sources: project.sources,
    deprecations: project.resolved?.deprecations,
    collections: project.collections.map((collection) => ({
      key: collection.key,
      sourceId: collection.sourceId,
      contentDir: collection.contentDir,
      navigationOrigin: collection.navigationOrigin,
    })),
  };
}

describe("generate resolves through the shared project pipeline", () => {
  it("sees the same project resolveProject sees", async () => {
    const dir = await sharedFixture();

    // Generate's exact resolution path: load, sync against the first-pass
    // graph, then the shared resolver — versus resolveProject's cache-only
    // discovery. If these views ever diverge, generate is building a project
    // doctor and the runtime would describe differently.
    const loaded = await loadLeadtypeConfig(dir);
    if (!loaded) {
      throw new Error("fixture config did not load");
    }
    await syncSources({
      mode: "missing",
      configDir: dir,
      sources: loaded.resolved.sources,
    });
    const generateView = await resolveProjectFromLoaded(loaded, {
      rootDir: dir,
      infer: false,
    });

    const projectView = await resolveProject({ cwd: dir });

    expect(generateView.diagnostics).toEqual([]);
    expect(view(generateView)).toEqual(view(projectView));
    // Pin the interesting values so agreement can't be two identical wrongs.
    expect(generateView.sources.map((source) => source.id)).toEqual([
      "local",
      "upstream",
    ]);
    expect(
      generateView.collections.map((collection) => [
        collection.key,
        collection.navigationOrigin,
      ])
    ).toEqual([
      ["changelog", "inferred"],
      ["guides", "inherited"],
    ]);
    expect(generateView.resolved.deprecations.map((entry) => entry.id)).toEqual(
      ["collection.prefix"]
    );
  });

  it("reports the acquisition graph resolveProject resolves", async () => {
    const dir = await sharedFixture();
    const outDir = path.join(dir, "out");
    const capture = createCapture();

    const code = await runGenerateCommand(
      ["--src", dir, "--out", outDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout()) as {
      sources?: unknown;
    };
    const project = await resolveProject({ cwd: dir });
    // The `--json` graph is the same object graph resolveProject hands every
    // other consumer — authored source names included.
    expect(result.sources).toEqual(project.sources);
  });
});
