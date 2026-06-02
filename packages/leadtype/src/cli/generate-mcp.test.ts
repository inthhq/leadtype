import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDocsArtifacts } from "../mcp/artifacts";
import { defineDocsTools } from "../mcp/tools";
import { parseGenerateArgs, runGenerateCommand } from "./generate";

const silentIo = {
  stderr: { write: () => true },
  stdout: { write: () => true },
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("parseGenerateArgs --mcp", () => {
  it("defaults mcp to false and parses the flag", () => {
    expect(parseGenerateArgs([]).mcp).toBe(false);
    expect(parseGenerateArgs(["--bundle", "--mcp"]).mcp).toBe(true);
  });
});

describe("generate --bundle --mcp", () => {
  let root: string;
  let outDir: string;
  let exitCode: number;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "leadtype-bundle-mcp-"));
    outDir = join(root, "out");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "docs", "quickstart.mdx"),
      [
        "---",
        "title: Quickstart",
        "description: Install and configure the package.",
        "---",
        "",
        "# Quickstart",
        "",
        "Install the package and run the generate command.",
      ].join("\n")
    );

    exitCode = await runGenerateCommand(
      [
        "--bundle",
        "--mcp",
        "--src",
        root,
        "--docs-dir",
        "docs",
        "--out",
        outDir,
        "--name",
        "Test Pkg",
        "--summary",
        "A test package.",
      ],
      silentIo
    );
  });

  afterAll(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("emits AGENTS.md plus the MCP artifacts into the bundle", async () => {
    expect(exitCode).toBe(0);
    expect(await exists(join(outDir, "AGENTS.md"))).toBe(true);
    expect(await exists(join(outDir, "docs", "search-index.json"))).toBe(true);
    expect(await exists(join(outDir, "docs", "agent-readability.json"))).toBe(
      true
    );
    // Bundle stays website-artifact-free even with --mcp.
    expect(await exists(join(outDir, "llms.txt"))).toBe(false);
  });

  it("the emitted bundle is servable by the MCP tools", async () => {
    const artifacts = await loadDocsArtifacts({ artifacts: outDir });
    const [search, getPage] = defineDocsTools(artifacts);

    const hits = JSON.parse(
      (await search.handler({ query: "quickstart" })).content[0].text
    ) as { urlPath: string }[];
    expect(hits.length).toBeGreaterThan(0);

    const page = await getPage.handler({ urlPath: hits[0].urlPath });
    expect(page.isError).toBeFalsy();
    expect(page.content[0].text).toContain("# Quickstart");
  });
});
