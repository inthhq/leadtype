import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSkillArtifacts } from "./skills";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "leadtype-skills-"));
  tempDirs.push(dir);
  return dir;
}

const product = { name: "Acme Docs", summary: "Docs for Acme." };

describe("generateSkillArtifacts — site mode", () => {
  it("emits the auto docs-skill, index.json, and agent-card", async () => {
    const outDir = await tempDir();
    const result = await generateSkillArtifacts({
      outDir,
      baseUrl: "https://acme.dev",
      product,
      mode: "site",
      mcpEnabled: true,
      provider: { organization: "Acme Inc", url: "https://acme.com" },
    });

    expect(result.skills).toEqual(["acme-docs-docs"]);

    const skillMd = await readFile(
      join(outDir, ".well-known/agent-skills/acme-docs-docs/SKILL.md"),
      "utf8"
    );
    expect(skillMd).toContain("name: acme-docs-docs");
    expect(skillMd).toContain("description:");
    // MCP enabled → the docs-skill points at the MCP server.
    expect(skillMd).toContain("MCP server");
    expect(skillMd).toContain("/llms.txt");

    const index = JSON.parse(
      await readFile(
        join(outDir, ".well-known/agent-skills/index.json"),
        "utf8"
      )
    ) as { skills: { name: string; integrity: string; path: string }[] };
    expect(index.skills[0].name).toBe("acme-docs-docs");
    expect(index.skills[0].integrity).toMatch(/^sha256-/);

    const card = JSON.parse(
      await readFile(join(outDir, ".well-known/agent-card.json"), "utf8")
    ) as {
      name: string;
      url: string;
      version: string;
      provider?: { organization: string; url?: string };
      documentationUrl?: string;
      capabilities?: Record<string, boolean>;
      defaultInputModes: string[];
      skills: { id: string; tags: string[] }[];
    };
    expect(card.name).toBe("Acme Docs");
    // A2A AgentCard: url is the MCP endpoint when enabled, + required version.
    expect(card.url).toBe("https://acme.dev/mcp");
    expect(card.version).toBe("1.0.0");
    expect(card.provider).toEqual({
      organization: "Acme Inc",
      url: "https://acme.com",
    });
    expect(card.documentationUrl).toBe("https://acme.dev/docs");
    expect(card.capabilities).toBeDefined();
    expect(card.defaultInputModes.length).toBeGreaterThan(0);
    expect(card.skills[0].tags).toContain("documentation");
  });

  it("includes author-declared skills and respects docsSkill: false", async () => {
    const outDir = await tempDir();
    const result = await generateSkillArtifacts({
      outDir,
      product,
      mode: "site",
      skills: {
        docsSkill: false,
        agentCard: false,
        items: [
          {
            name: "deploy",
            description: "Deploy an Acme app.",
            license: "MIT",
            allowedTools: ["Bash", "Read"],
            body: "# Deploy\n\nRun the deploy.\n",
          },
        ],
      },
    });

    expect(result.skills).toEqual(["deploy"]);
    const skillMd = await readFile(
      join(outDir, ".well-known/agent-skills/deploy/SKILL.md"),
      "utf8"
    );
    expect(skillMd).toContain("allowed-tools: Bash Read");
    expect(skillMd).toContain("license: MIT");
    // agentCard: false → no card.
    expect(result.files.some((f) => f.endsWith("agent-card.json"))).toBe(false);
  });
});

describe("generateSkillArtifacts — bundle mode", () => {
  it("writes a single offline-pointing SKILL.md next to AGENTS.md", async () => {
    const outDir = await tempDir();
    const result = await generateSkillArtifacts({
      outDir,
      product,
      mode: "bundle",
    });
    expect(result.files).toHaveLength(1);
    const skillMd = await readFile(join(outDir, "SKILL.md"), "utf8");
    expect(skillMd).toContain("./AGENTS.md");
    expect(skillMd).not.toContain("/llms.txt");
  });
});
