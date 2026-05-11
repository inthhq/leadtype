import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../../lib/transcript";

const transcript = await readTranscript();
const projectRoot = process.env.TRANSCRIPT_PATH
  ? resolve(dirname(process.env.TRANSCRIPT_PATH), "..")
  : "";

const reads = transcript.toolCalls
  .filter((c) => c.tool === "read" && typeof c.args.path === "string")
  .map((c) => c.args.path as string);

const npmCalls = transcript.toolCalls.filter((c) => c.tool === "npm");

describe("bundle-own-docs", () => {
  it("agent read AGENTS.md", () => {
    expect(
      reads.some((p) => p.includes("node_modules/leadtype/AGENTS.md"))
    ).toBe(true);
  });

  it("agent read the bundle guide", () => {
    expect(
      reads.some((p) =>
        p.includes("node_modules/leadtype/docs/package-docs/bundle.md")
      )
    ).toBe(true);
  });

  it("package.json has AGENTS.md in files and a prepack script using --bundle", () => {
    const pkgPath = resolve(projectRoot, "package.json");
    if (!existsSync(pkgPath)) {
      throw new Error(`package.json not at ${pkgPath}`);
    }
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      files?: string[];
      scripts?: Record<string, string>;
    };
    expect(pkg.files ?? []).toContain("AGENTS.md");
    const prepack = pkg.scripts?.prepack ?? "";
    expect(prepack).toMatch(/leadtype/);
    expect(prepack).toMatch(/--bundle/);
  });

  it("agent ran npm pack --dry-run via the npm tool", () => {
    expect(
      npmCalls.some(
        (c) =>
          c.args.subcommand === "pack" &&
          Array.isArray(c.args.args) &&
          (c.args.args as string[]).includes("--dry-run")
      )
    ).toBe(true);
  });

  it("a stub docs/index.mdx was created", () => {
    expect(
      transcript.filesModified.some((p) => p.endsWith("docs/index.mdx"))
    ).toBe(true);
  });
});
