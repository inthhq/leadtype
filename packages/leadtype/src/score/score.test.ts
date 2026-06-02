import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runScoreCommand } from "../cli/score";
import { scoreDocs } from "./score";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "leadtype-score-"));
  tempDirs.push(dir);
  return dir;
}

const MANIFEST = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  baseUrl: "https://example.com",
  product: { name: "Acme", summary: "Docs." },
  navigation: { groups: [], ungrouped: [], unknown: [] },
  files: {
    robotsTxt: "/docs/robots.txt",
    sitemapMd: "/docs/sitemap.md",
    sitemapXml: "/docs/sitemap.xml",
  },
  pages: [
    {
      title: "Quickstart",
      description: "Install it.",
      urlPath: "/docs/quickstart",
      absoluteUrl: "https://example.com/docs/quickstart",
      markdownUrlPath: "/docs/quickstart.md",
      markdownAbsoluteUrl: "https://example.com/docs/quickstart.md",
      relativePath: "quickstart",
      groups: [],
      lastModified: "2026-01-01T00:00:00.000Z",
    },
  ],
};

async function writeSiteArtifacts(outDir: string): Promise<void> {
  await mkdir(join(outDir, "docs"), { recursive: true });
  await mkdir(join(outDir, ".well-known"), { recursive: true });
  await writeFile(join(outDir, "llms.txt"), "# Acme\n");
  await writeFile(join(outDir, "llms-full.txt"), "# Acme\n");
  await writeFile(join(outDir, ".well-known", "llms.txt"), "# Acme\n");
  await writeFile(join(outDir, "docs", "search-index.json"), "{}");
  await writeFile(
    join(outDir, "docs", "agent-readability.json"),
    JSON.stringify(MANIFEST)
  );
}

describe("scoreDocs", () => {
  it("scores a full site build high with Identity complete", async () => {
    const outDir = await tempDir();
    await writeSiteArtifacts(outDir);

    const result = await scoreDocs({ outDir, srcDir: join(outDir, "missing") });
    const identity = result.dimensions.find((d) => d.id === "identity");
    expect(identity?.points).toBe(identity?.max);
    expect(result.score).toBeGreaterThanOrEqual(80);
    // The skills surface (Phase 3) isn't emitted, so Integration isn't full.
    const integration = result.dimensions.find((d) => d.id === "integration");
    expect(integration?.points).toBeLessThan(integration?.max ?? 0);
  });

  it("scores an empty build low, with fixes and out-of-lane dimensions", async () => {
    const outDir = await tempDir();
    const result = await scoreDocs({ outDir, srcDir: join(outDir, "missing") });

    expect(result.score).toBeLessThan(40);
    expect(result.fixes.length).toBeGreaterThan(0);
    // Discovery / Auth / UX are shown but excluded from the score.
    const outOfLane = result.dimensions.filter((d) => !d.inLane);
    expect(outOfLane.map((d) => d.id).sort()).toEqual([
      "auth",
      "discovery",
      "ux",
    ]);
    for (const dim of outOfLane) {
      expect(dim.note).toBeTruthy();
      expect(dim.max).toBe(0);
    }
  });
});

describe("runScoreCommand", () => {
  it("exits 1 when below --min, 0 otherwise", async () => {
    const outDir = await tempDir();
    await writeSiteArtifacts(outDir);
    const io = { stderr: { write: () => true }, stdout: { write: () => true } };

    expect(
      await runScoreCommand(
        ["--out", outDir, "--src", "nope", "--min", "100"],
        io
      )
    ).toBe(1);
    expect(
      await runScoreCommand(
        ["--out", outDir, "--src", "nope", "--min", "50"],
        io
      )
    ).toBe(0);
  });

  it("emits JSON with --json", async () => {
    const outDir = await tempDir();
    await writeSiteArtifacts(outDir);
    let out = "";
    const io = {
      stderr: { write: () => true },
      stdout: {
        write: (chunk: string) => {
          out += chunk;
          return true;
        },
      },
    };
    await runScoreCommand(["--out", outDir, "--src", "nope", "--json"], io);
    const parsed = JSON.parse(out) as { score: number; dimensions: unknown[] };
    expect(typeof parsed.score).toBe("number");
    expect(parsed.dimensions.length).toBeGreaterThan(0);
  });
});
