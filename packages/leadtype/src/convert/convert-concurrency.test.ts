import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertAllMdx } from "./convert";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-convert-race-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("convertAllMdx concurrency", () => {
  it("keeps every output complete while concurrent runs share an outDir", async () => {
    const dir = await createTempProject();
    const srcDir = path.join(dir, "docs");
    const outDir = path.join(dir, "public", "docs");
    const fileCount = 24;
    const concurrentRuns = 3;
    // Large enough that a truncating write would be observable mid-flight.
    const filler =
      "Some paragraph text that pads the document body.\n\n".repeat(200);

    await mkdir(srcDir, { recursive: true });
    await Promise.all(
      Array.from({ length: fileCount }, (_, index) =>
        writeFile(
          path.join(srcDir, `doc-${index}.mdx`),
          `---\ntitle: "Doc ${index}"\n---\n\n# Doc ${index}\n\n${filler}\nEND-OF-DOC-${index}\n`
        )
      )
    );

    let runsSettled = false;
    const runs = Promise.all(
      Array.from({ length: concurrentRuns }, () =>
        convertAllMdx({ srcDir, outDir })
      )
    ).finally(() => {
      runsSettled = true;
    });

    // Concurrent reader modeling a sibling build step (tsc, next build)
    // reading the shared output directory while generation is in flight:
    // every successfully read file must be complete, and a file must never
    // disappear once it has been observed.
    const seen = new Set<number>();
    const reader = (async () => {
      while (!runsSettled) {
        for (let index = 0; index < fileCount; index++) {
          const outputPath = path.join(outDir, `doc-${index}.md`);
          try {
            const content = await readFile(outputPath, "utf8");
            seen.add(index);
            expect(content.startsWith("---")).toBe(true);
            expect(content).toContain(`END-OF-DOC-${index}`);
          } catch (error) {
            expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
            expect(seen.has(index)).toBe(false);
          }
        }
      }
    })();

    await Promise.all([runs, reader]);

    // Final state: every output present and complete, no temp files leaked.
    const entries = await readdir(outDir);
    expect(entries.sort()).toEqual(
      Array.from({ length: fileCount }, (_, index) => `doc-${index}.md`).sort()
    );
    for (let index = 0; index < fileCount; index++) {
      const content = await readFile(
        path.join(outDir, `doc-${index}.md`),
        "utf8"
      );
      expect(content).toContain(`END-OF-DOC-${index}`);
    }
  });
});
