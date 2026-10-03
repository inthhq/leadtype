import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { copyMountedMarkdownMirrors } from "./mounted-markdown";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "leadtype-mirror-"));
  roots.push(root);
  const outDir = path.join(root, "public");
  const stateDir = path.join(root, ".leadtype");
  await mkdir(path.join(outDir, "docs/changelog"), { recursive: true });
  await writeFile(path.join(outDir, "docs/index.md"), "Home");
  await writeFile(path.join(outDir, "docs/changelog/v1.md"), "Release one");
  return { outDir, stateDir, sourceFiles: ["index.md", "changelog/v1.md"] };
}

it("preserves primary docs, sibling mounts, and unrelated markdown across repeated root generation", async () => {
  const { outDir, stateDir, sourceFiles } = await fixture();
  await writeFile(path.join(outDir, "README.md"), "Host README");
  const mounts = [
    { pathPrefix: "", urlPrefix: "/" },
    { pathPrefix: "changelog", urlPrefix: "/releases" },
  ];
  for (const orderedMounts of [mounts, [...mounts].reverse()]) {
    await copyMountedMarkdownMirrors(outDir, orderedMounts, sourceFiles, {
      stateDir,
    });
    expect(await readFile(path.join(outDir, "index.md"), "utf8")).toBe("Home");
    expect(await readFile(path.join(outDir, "docs/index.md"), "utf8")).toBe(
      "Home"
    );
    expect(await readFile(path.join(outDir, "releases/v1.md"), "utf8")).toBe(
      "Release one"
    );
    expect(await readFile(path.join(outDir, "README.md"), "utf8")).toBe(
      "Host README"
    );
  }
});

it("prunes removed mirrors but preserves files edited after generation", async () => {
  const { outDir, stateDir, sourceFiles } = await fixture();
  const mounts = [{ pathPrefix: "", urlPrefix: "/" }];
  await copyMountedMarkdownMirrors(outDir, mounts, sourceFiles, { stateDir });
  await writeFile(path.join(outDir, "index.md"), "Host replacement");
  await rm(path.join(outDir, "docs/changelog/v1.md"));
  await rm(path.join(outDir, "docs/index.md"));
  await copyMountedMarkdownMirrors(outDir, mounts, sourceFiles, { stateDir });
  expect(existsSync(path.join(outDir, "changelog/v1.md"))).toBe(false);
  expect(existsSync(path.join(outDir, "changelog"))).toBe(false);
  expect(await readFile(path.join(outDir, "index.md"), "utf8")).toBe(
    "Host replacement"
  );
});

it("removes obsolete mount output when the mount moves or is removed", async () => {
  const { outDir, stateDir, sourceFiles } = await fixture();
  await copyMountedMarkdownMirrors(
    outDir,
    [{ pathPrefix: "changelog", urlPrefix: "/releases" }],
    sourceFiles,
    { stateDir }
  );
  await copyMountedMarkdownMirrors(
    outDir,
    [{ pathPrefix: "changelog", urlPrefix: "/updates" }],
    sourceFiles,
    { stateDir }
  );
  expect(existsSync(path.join(outDir, "releases/v1.md"))).toBe(false);
  expect(await readFile(path.join(outDir, "updates/v1.md"), "utf8")).toBe(
    "Release one"
  );
  await copyMountedMarkdownMirrors(outDir, [], sourceFiles, { stateDir });
  expect(existsSync(path.join(outDir, "updates/v1.md"))).toBe(false);
  expect(
    await readFile(path.join(outDir, "docs/changelog/v1.md"), "utf8")
  ).toBe("Release one");
});

it("does not recursively copy a mirror nested inside its source", async () => {
  const { outDir, stateDir, sourceFiles } = await fixture();
  const mounts = [
    { pathPrefix: "changelog", urlPrefix: "/docs/changelog/public" },
  ];
  await copyMountedMarkdownMirrors(outDir, mounts, sourceFiles, { stateDir });
  await copyMountedMarkdownMirrors(outDir, mounts, sourceFiles, { stateDir });
  expect(
    await readFile(path.join(outDir, "docs/changelog/public/v1.md"), "utf8")
  ).toBe("Release one");
  expect(existsSync(path.join(outDir, "docs/changelog/public/public"))).toBe(
    false
  );
  await rm(path.join(outDir, "docs/changelog/v1.md"));
  await copyMountedMarkdownMirrors(outDir, mounts, sourceFiles, { stateDir });
  expect(existsSync(path.join(outDir, "docs/changelog/public/v1.md"))).toBe(
    false
  );
});

it("rejects a root mirror that would overwrite primary docs", async () => {
  const { outDir, stateDir, sourceFiles } = await fixture();
  sourceFiles.push("docs/index.md");
  await mkdir(path.join(outDir, "docs/docs"));
  await writeFile(path.join(outDir, "docs/docs/index.md"), "Nested home");
  await expect(
    copyMountedMarkdownMirrors(
      outDir,
      [{ pathPrefix: "", urlPrefix: "/" }],
      sourceFiles,
      { stateDir }
    )
  ).rejects.toThrow("would overwrite primary docs");
  expect(await readFile(path.join(outDir, "docs/index.md"), "utf8")).toBe(
    "Home"
  );
});

it("regenerates nested mirrors after ownership state is lost", async () => {
  const { outDir, stateDir, sourceFiles } = await fixture();
  const mounts = [
    { pathPrefix: "changelog", urlPrefix: "/docs/changelog/public" },
  ];
  await copyMountedMarkdownMirrors(outDir, mounts, sourceFiles, { stateDir });
  await rm(stateDir, { recursive: true, force: true });
  await copyMountedMarkdownMirrors(outDir, mounts, sourceFiles, { stateDir });
  expect(
    await readFile(path.join(outDir, "docs/changelog/public/v1.md"), "utf8")
  ).toBe("Release one");
});

it("writes mirrors when ownership storage is unavailable", async () => {
  const { outDir, stateDir, sourceFiles } = await fixture();
  await writeFile(stateDir, "This path is a file, not a writable directory.");
  await copyMountedMarkdownMirrors(
    outDir,
    [{ pathPrefix: "changelog", urlPrefix: "/releases" }],
    sourceFiles,
    { stateDir }
  );
  expect(await readFile(path.join(outDir, "releases/v1.md"), "utf8")).toBe(
    "Release one"
  );
});

it("preserves excluded mirrors and their ownership until the next full run", async () => {
  const { outDir, stateDir, sourceFiles } = await fixture();
  await writeFile(path.join(outDir, "docs/changelog/v2.md"), "Release two");
  sourceFiles.push("changelog/v2.md");
  const mounts = [{ pathPrefix: "changelog", urlPrefix: "/releases" }];
  await copyMountedMarkdownMirrors(outDir, mounts, sourceFiles, { stateDir });
  await copyMountedMarkdownMirrors(outDir, mounts, ["changelog/v1.md"], {
    stateDir,
    prune: false,
  });
  expect(await readFile(path.join(outDir, "releases/v2.md"), "utf8")).toBe(
    "Release two"
  );
  await rm(path.join(outDir, "docs/changelog/v2.md"));
  await copyMountedMarkdownMirrors(outDir, mounts, ["changelog/v1.md"], {
    stateDir,
  });
  expect(existsSync(path.join(outDir, "releases/v2.md"))).toBe(false);
});
