import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../../lib/transcript";

const transcript = await readTranscript();
// TRANSCRIPT_PATH is <tempDir>/__transcript__/transcript.json — the project
// root (where the agent wrote files) is two levels up from that file.
const projectRoot = process.env.TRANSCRIPT_PATH
  ? resolve(dirname(process.env.TRANSCRIPT_PATH), "..")
  : "";

const reads = transcript.toolCalls
  .filter((c) => c.tool === "read")
  .map((c) => (c.args.path as string) ?? "");

describe("wire-content-negotiation", () => {
  it("agent discovered the bundled AGENTS.md", () => {
    expect(
      reads.some((p) => p.includes("node_modules/leadtype/AGENTS.md")),
      `agent did not read node_modules/leadtype/AGENTS.md (read paths: ${JSON.stringify(reads)})`
    ).toBe(true);
  });

  it("agent followed AGENTS.md to the connect-docs-site topic", () => {
    expect(
      reads.some((p) =>
        p.includes("node_modules/leadtype/docs/build/connect-docs-site.md")
      ),
      "agent did not read the connect-docs-site topic via AGENTS.md links"
    ).toBe(true);
  });

  it("vite.config.ts was modified", () => {
    expect(
      transcript.filesModified.some((p) => p.endsWith("vite.config.ts"))
    ).toBe(true);
  });

  it("middleware sets charset=utf-8", () => {
    const viteConfigPath = resolve(projectRoot, "vite.config.ts");
    if (!existsSync(viteConfigPath)) {
      throw new Error(`vite.config.ts not at expected path ${viteConfigPath}`);
    }
    const source = readFileSync(viteConfigPath, "utf-8");
    expect(source).toMatch(/charset=utf-8/i);
  });

  it("middleware rewrites /docs/* paths to .md", () => {
    const viteConfigPath = resolve(projectRoot, "vite.config.ts");
    const source = readFileSync(viteConfigPath, "utf-8");
    expect(source).toMatch(/\/docs/);
    expect(source).toMatch(/\.md/);
    expect(source).toMatch(/text\/(markdown|plain)/i);
  });
});
