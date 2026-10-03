import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { includeMarkdown } from "../markdown";
import { convertAllMdx } from "./convert";
import { loadConvertCacheManifest } from "./incremental";

const tempDirs: string[] = [];
const TAMPER_MARKER = "<!-- tampered by test -->";

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

type CacheProject = {
  root: string;
  srcDir: string;
  outDir: string;
  cacheFile: string;
};

async function createCacheProject(): Promise<CacheProject> {
  const root = await mkdtemp(path.join(tmpdir(), "leadtype-incremental-"));
  tempDirs.push(root);
  const srcDir = path.join(root, "docs");
  const outDir = path.join(root, "out");
  await mkdir(srcDir, { recursive: true });
  return {
    root,
    srcDir,
    outDir,
    cacheFile: path.join(root, "cache", "convert.json"),
  };
}

function runConvert(
  project: CacheProject,
  overrides: { fingerprint?: string; force?: boolean } = {}
): Promise<void> {
  return convertAllMdx({
    srcDir: project.srcDir,
    outDir: project.outDir,
    markdownTransforms: [includeMarkdown],
    cache: {
      file: project.cacheFile,
      fingerprint: overrides.fingerprint ?? "test-fingerprint",
      ...(overrides.force ? { force: true } : {}),
    },
  });
}

async function tamper(outputPath: string): Promise<void> {
  const current = await readFile(outputPath, "utf8");
  await writeFile(outputPath, `${current}\n${TAMPER_MARKER}\n`);
}

async function isTampered(outputPath: string): Promise<boolean> {
  const current = await readFile(outputPath, "utf8");
  return current.includes(TAMPER_MARKER);
}

describe("convertAllMdx incremental cache", () => {
  it("skips unchanged files on the second run", async () => {
    const project = await createCacheProject();
    await writeFile(
      path.join(project.srcDir, "alpha.mdx"),
      "---\ntitle: Alpha\n---\n\n# Alpha\n"
    );
    await writeFile(
      path.join(project.srcDir, "beta.mdx"),
      "---\ntitle: Beta\n---\n\n# Beta\n"
    );

    await runConvert(project);
    const alphaOut = path.join(project.outDir, "alpha.md");
    const betaOut = path.join(project.outDir, "beta.md");
    expect(existsSync(alphaOut)).toBe(true);
    expect(existsSync(betaOut)).toBe(true);

    // A cached skip must leave the existing output untouched — tampering the
    // outputs makes a rewrite observable.
    await tamper(alphaOut);
    await tamper(betaOut);
    await runConvert(project);
    expect(await isTampered(alphaOut)).toBe(true);
    expect(await isTampered(betaOut)).toBe(true);
  });

  it("rebuilds only the edited file", async () => {
    const project = await createCacheProject();
    const alphaSrc = path.join(project.srcDir, "alpha.mdx");
    await writeFile(alphaSrc, "---\ntitle: Alpha\n---\n\n# Alpha\n");
    await writeFile(
      path.join(project.srcDir, "beta.mdx"),
      "---\ntitle: Beta\n---\n\n# Beta\n"
    );

    await runConvert(project);
    const alphaOut = path.join(project.outDir, "alpha.md");
    const betaOut = path.join(project.outDir, "beta.md");
    await tamper(alphaOut);
    await tamper(betaOut);

    await writeFile(alphaSrc, "---\ntitle: Alpha\n---\n\n# Alpha edited\n");
    await runConvert(project);

    expect(await isTampered(alphaOut)).toBe(false);
    expect(await readFile(alphaOut, "utf8")).toContain("Alpha edited");
    expect(await isTampered(betaOut)).toBe(true);
  });

  it("rebuilds a file when its include target changes", async () => {
    const project = await createCacheProject();
    const snippetPath = path.join(project.srcDir, "snippet.mdx");
    await writeFile(snippetPath, "Shared snippet v1.\n");
    await writeFile(
      path.join(project.srcDir, "page.mdx"),
      '---\ntitle: Page\n---\n\n<include src="./snippet.mdx" />\n'
    );
    await writeFile(
      path.join(project.srcDir, "other.mdx"),
      "---\ntitle: Other\n---\n\n# Other\n"
    );

    await runConvert(project);
    const pageOut = path.join(project.outDir, "page.md");
    const otherOut = path.join(project.outDir, "other.md");
    expect(await readFile(pageOut, "utf8")).toContain("Shared snippet v1.");
    await tamper(pageOut);
    await tamper(otherOut);

    await writeFile(snippetPath, "Shared snippet v2.\n");
    await runConvert(project);

    expect(await readFile(pageOut, "utf8")).toContain("Shared snippet v2.");
    expect(await isTampered(pageOut)).toBe(false);
    expect(await isTampered(otherOut)).toBe(true);
  });

  it("records include targets as dependencies in the manifest", async () => {
    const project = await createCacheProject();
    const snippetPath = path.join(project.srcDir, "snippet.mdx");
    await writeFile(snippetPath, "Shared snippet.\n");
    await writeFile(
      path.join(project.srcDir, "page.mdx"),
      '---\ntitle: Page\n---\n\n<include src="./snippet.mdx" />\n'
    );

    await runConvert(project);
    const manifest = await loadConvertCacheManifest(
      project.cacheFile,
      "test-fingerprint"
    );
    expect(manifest).not.toBeNull();
    const entry = manifest?.entries["page.mdx"];
    expect(entry).toBeDefined();
    expect(Object.keys(entry?.deps ?? {})).toContain(snippetPath);
  });

  it("prunes the output of a deleted source file", async () => {
    const project = await createCacheProject();
    const alphaSrc = path.join(project.srcDir, "alpha.mdx");
    await writeFile(alphaSrc, "---\ntitle: Alpha\n---\n\n# Alpha\n");
    await writeFile(
      path.join(project.srcDir, "beta.mdx"),
      "---\ntitle: Beta\n---\n\n# Beta\n"
    );

    await runConvert(project);
    const alphaOut = path.join(project.outDir, "alpha.md");
    expect(existsSync(alphaOut)).toBe(true);

    await rm(alphaSrc);
    await runConvert(project);

    expect(existsSync(alphaOut)).toBe(false);
    expect(existsSync(path.join(project.outDir, "beta.md"))).toBe(true);
  });

  it("prunes a deleted source's output on a --force run", async () => {
    const project = await createCacheProject();
    const alphaSrc = path.join(project.srcDir, "alpha.mdx");
    await writeFile(alphaSrc, "---\ntitle: Alpha\n---\n\n# Alpha\n");
    await writeFile(
      path.join(project.srcDir, "beta.mdx"),
      "---\ntitle: Beta\n---\n\n# Beta\n"
    );

    await runConvert(project);
    const alphaOut = path.join(project.outDir, "alpha.md");
    expect(existsSync(alphaOut)).toBe(true);

    // Force empties the reusable entry set — pruning must still see the last
    // run's manifest or the deleted source's output lingers forever.
    await rm(alphaSrc);
    await runConvert(project, { force: true });

    expect(existsSync(alphaOut)).toBe(false);
    expect(existsSync(path.join(project.outDir, "beta.md"))).toBe(true);
  });

  it("prunes a deleted source's output across a fingerprint change", async () => {
    const project = await createCacheProject();
    const alphaSrc = path.join(project.srcDir, "alpha.mdx");
    await writeFile(alphaSrc, "---\ntitle: Alpha\n---\n\n# Alpha\n");
    await writeFile(
      path.join(project.srcDir, "beta.mdx"),
      "---\ntitle: Beta\n---\n\n# Beta\n"
    );

    await runConvert(project);
    const alphaOut = path.join(project.outDir, "alpha.md");
    expect(existsSync(alphaOut)).toBe(true);

    await rm(alphaSrc);
    await runConvert(project, { fingerprint: "different-fingerprint" });

    expect(existsSync(alphaOut)).toBe(false);
    expect(existsSync(path.join(project.outDir, "beta.md"))).toBe(true);
  });

  it("rejects a manifest whose entries are malformed instead of crashing", async () => {
    const project = await createCacheProject();
    await writeFile(
      path.join(project.srcDir, "alpha.mdx"),
      "---\ntitle: Alpha\n---\n\n# Alpha\n"
    );
    await runConvert(project);

    // Hand-corrupt one entry: syntactically valid JSON, missing `output`.
    // Pruning resolves `entry.output` unconditionally, so a partially-written
    // entry must reject the whole manifest (full rebuild), never throw.
    const manifest = JSON.parse(await readFile(project.cacheFile, "utf8")) as {
      entries: Record<string, Record<string, unknown>>;
    };
    const firstKey = Object.keys(manifest.entries)[0] as string;
    manifest.entries[firstKey] = { sourceHash: "abc" };
    await writeFile(project.cacheFile, JSON.stringify(manifest));

    expect(await loadConvertCacheManifest(project.cacheFile)).toBeNull();

    const alphaOut = path.join(project.outDir, "alpha.md");
    await tamper(alphaOut);
    await runConvert(project);
    // Rejected manifest → full rebuild → the tampered output is rewritten.
    expect(await isTampered(alphaOut)).toBe(false);
  });

  it("rebuilds everything with force", async () => {
    const project = await createCacheProject();
    await writeFile(
      path.join(project.srcDir, "alpha.mdx"),
      "---\ntitle: Alpha\n---\n\n# Alpha\n"
    );

    await runConvert(project);
    const alphaOut = path.join(project.outDir, "alpha.md");
    await tamper(alphaOut);

    await runConvert(project, { force: true });
    expect(await isTampered(alphaOut)).toBe(false);
  });

  it("rebuilds everything when the fingerprint changes", async () => {
    const project = await createCacheProject();
    await writeFile(
      path.join(project.srcDir, "alpha.mdx"),
      "---\ntitle: Alpha\n---\n\n# Alpha\n"
    );

    await runConvert(project);
    const alphaOut = path.join(project.outDir, "alpha.md");
    await tamper(alphaOut);

    await runConvert(project, { fingerprint: "different-fingerprint" });
    expect(await isTampered(alphaOut)).toBe(false);
  });

  it("regenerates a missing output even when the source is unchanged", async () => {
    const project = await createCacheProject();
    await writeFile(
      path.join(project.srcDir, "alpha.mdx"),
      "---\ntitle: Alpha\n---\n\n# Alpha\n"
    );

    await runConvert(project);
    const alphaOut = path.join(project.outDir, "alpha.md");
    await rm(alphaOut);

    await runConvert(project);
    expect(existsSync(alphaOut)).toBe(true);
  });

  it("survives a corrupt manifest by rebuilding", async () => {
    const project = await createCacheProject();
    await writeFile(
      path.join(project.srcDir, "alpha.mdx"),
      "---\ntitle: Alpha\n---\n\n# Alpha\n"
    );

    await runConvert(project);
    await writeFile(project.cacheFile, "{not json");
    const alphaOut = path.join(project.outDir, "alpha.md");
    await tamper(alphaOut);

    await runConvert(project);
    expect(await isTampered(alphaOut)).toBe(false);
  });
});
