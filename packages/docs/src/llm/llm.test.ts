import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateLLMSummaries } from "./llm";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "inth-docs-llm-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

describe("generateLLMSummaries", () => {
  it("falls back to section-friendly titles and descriptions for index routes", async () => {
    const projectDir = await createTempProject();
    const docsDir = path.join(projectDir, "docs", "frameworks");
    const outDir = path.join(projectDir, "out");

    await mkdir(docsDir, { recursive: true });
    await writeFile(
      path.join(docsDir, "index.mdx"),
      `<Cards>
  <Card title="React" href="/docs/frameworks/react/quickstart" />
</Cards>
`
    );

    await generateLLMSummaries({
      srcDir: projectDir,
      outDir,
      baseUrl: "https://c15t.com",
      product: {
        name: "c15t",
        summary: "Consent platform.",
        bestStartingPoints: [{ urlPath: "/docs/frameworks" }],
      },
      docsSections: [
        {
          title: "Frameworks",
          links: [{ urlPath: "/docs/frameworks" }],
        },
      ],
    });

    const rootSummary = await readFile(path.join(outDir, "llms.txt"), "utf8");
    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );

    expect(rootSummary).toContain(
      "[Frameworks](https://c15t.com/docs/frameworks)"
    );
    expect(rootSummary).toContain("Entry point for Frameworks documentation.");
    expect(rootSummary).not.toContain("[Index]");
    expect(docsSummary).not.toContain("No description provided.");
  });
});
