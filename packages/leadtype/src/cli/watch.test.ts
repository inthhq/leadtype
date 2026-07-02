import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseGenerateArgs } from "./generate";
import { type WatchController, watchInputs } from "./watch";

const tempDirs: string[] = [];
const controllers: WatchController[] = [];
const EVENT_TIMEOUT_MS = 5000;

afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    controller.close();
  }
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-watch-"));
  tempDirs.push(dir);
  return dir;
}

function watchCollecting(options: {
  paths: string[];
  ignorePaths?: string[];
  debounceMs?: number;
}): { batches: string[][]; nextBatch: () => Promise<string[]> } {
  const batches: string[][] = [];
  let notify: (() => void) | undefined;
  const controller = watchInputs({
    paths: options.paths,
    ignorePaths: options.ignorePaths,
    debounceMs: options.debounceMs ?? 50,
    onChange: (changedPaths) => {
      batches.push(changedPaths);
      notify?.();
    },
  });
  controllers.push(controller);
  const nextBatch = (): Promise<string[]> => {
    const known = batches.length;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        rejectPromise(new Error("timed out waiting for a watch batch"));
      }, EVENT_TIMEOUT_MS);
      const check = (): void => {
        const batch = batches[known];
        if (batch) {
          clearTimeout(timer);
          resolvePromise(batch);
          return;
        }
        notify = check;
      };
      check();
    });
  };
  return { batches, nextBatch };
}

async function settle(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

describe("watchInputs", () => {
  it("fires a debounced batch for changes under a watched directory", async () => {
    const dir = await createTempDir();
    const { nextBatch } = watchCollecting({ paths: [dir] });
    // Give the OS watcher a beat to become active before writing.
    await settle(100);

    await writeFile(path.join(dir, "page.mdx"), "# Page\n");
    const batch = await nextBatch();
    expect(batch.some((changed) => changed.endsWith("page.mdx"))).toBe(true);
  });

  it("coalesces rapid changes into one batch", async () => {
    const dir = await createTempDir();
    // A wide debounce so both writes land in one window even with slow
    // FSEvents delivery.
    const { batches, nextBatch } = watchCollecting({
      paths: [dir],
      debounceMs: 500,
    });
    await settle(100);

    await writeFile(path.join(dir, "one.mdx"), "# One\n");
    await writeFile(path.join(dir, "two.mdx"), "# Two\n");
    const batch = await nextBatch();
    expect(batch.some((changed) => changed.endsWith("one.mdx"))).toBe(true);
    expect(batch.some((changed) => changed.endsWith("two.mdx"))).toBe(true);
    // Wait past another debounce window: no second batch should arrive.
    await settle(700);
    expect(batches.length).toBe(1);
  });

  it("ignores changes under ignored prefixes", async () => {
    const dir = await createTempDir();
    const outDir = path.join(dir, "public");
    await mkdir(outDir, { recursive: true });
    const { batches } = watchCollecting({
      paths: [dir],
      ignorePaths: [outDir],
    });
    await settle(100);

    await writeFile(path.join(outDir, "generated.md"), "generated\n");
    await settle(300);
    expect(batches.length).toBe(0);
  });

  it("watches a single file", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "leadtype.config.ts");
    await writeFile(configPath, "export default {};\n");
    const { nextBatch } = watchCollecting({ paths: [configPath] });
    await settle(100);

    await writeFile(configPath, "export default { product: {} };\n");
    const batch = await nextBatch();
    expect(batch).toContain(configPath);
  });

  it("skips watch paths that do not exist", () => {
    const controller = watchInputs({
      paths: [path.join(tmpdir(), "leadtype-watch-missing", "nope")],
      onChange: () => {
        throw new Error("should never fire");
      },
    });
    controllers.push(controller);
    controller.close();
  });
});

describe("parseGenerateArgs watch flags", () => {
  it("defaults watch and force to off", () => {
    const args = parseGenerateArgs([]);
    expect(args.watch).toBe(false);
    expect(args.force).toBe(false);
  });

  it("parses --watch and -w", () => {
    expect(parseGenerateArgs(["--watch"]).watch).toBe(true);
    expect(parseGenerateArgs(["-w"]).watch).toBe(true);
  });

  it("parses --force", () => {
    expect(parseGenerateArgs(["--force"]).force).toBe(true);
  });
});
