import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintDocs } from "./runner";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

/**
 * A project with a docs tree and a tiny installed package (`fakepkg`)
 * exporting `greet(name: string): string` — the target snippets typecheck
 * against.
 */
async function createTypecheckProject(): Promise<{
  projectRoot: string;
  srcDir: string;
}> {
  const projectRoot = await mkdtemp(
    path.join(tmpdir(), "leadtype-snippet-types-")
  );
  tempDirs.push(projectRoot);
  const srcDir = path.join(projectRoot, "docs");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true } })
  );
  const pkgDir = path.join(projectRoot, "node_modules", "fakepkg");
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "fakepkg",
      version: "1.0.0",
      main: "index.js",
      types: "index.d.ts",
    })
  );
  await writeFile(
    path.join(pkgDir, "index.d.ts"),
    "export declare function greet(name: string): string;\n"
  );
  await writeFile(
    path.join(pkgDir, "index.js"),
    "exports.greet = (name) => 'hi ' + name;\n"
  );
  return { projectRoot, srcDir };
}

async function lintWithTypecheck(
  projectRoot: string,
  srcDir: string,
  body: string
): Promise<Awaited<ReturnType<typeof lintDocs>>["violations"]> {
  await writeFile(
    path.join(srcDir, "index.mdx"),
    `---\ntitle: Home\n---\n${body}`
  );
  const result = await lintDocs({
    srcDir,
    snippetTypecheck: { projectRoot },
  });
  return result.violations.filter(
    (violation) => violation.rule === "snippet:types"
  );
}

describe("snippet typechecking", () => {
  it("fails snippets calling an API that does not exist", async () => {
    const { projectRoot, srcDir } = await createTypecheckProject();
    const violations = await lintWithTypecheck(
      projectRoot,
      srcDir,
      [
        "```ts",
        'import { greet } from "fakepkg";',
        "",
        "greet(42);",
        "```",
        "",
      ].join("\n")
    );
    expect(violations).toEqual([
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("number"),
      }),
    ]);
  });

  it("passes snippets using the API correctly", async () => {
    const { projectRoot, srcDir } = await createTypecheckProject();
    const violations = await lintWithTypecheck(
      projectRoot,
      srcDir,
      [
        "```ts",
        'import { greet } from "fakepkg";',
        "",
        'greet("docs");',
        "```",
        "",
      ].join("\n")
    );
    expect(violations).toEqual([]);
  });

  it("checks multi-file snippets split by @filename", async () => {
    const { projectRoot, srcDir } = await createTypecheckProject();
    const violations = await lintWithTypecheck(
      projectRoot,
      srcDir,
      [
        "```ts",
        "// @filename: helpers.ts",
        'export const NAME = "docs";',
        "// @filename: main.ts",
        'import { greet } from "fakepkg";',
        'import { NAME } from "./helpers";',
        "",
        "greet(NAME);",
        "```",
        "",
      ].join("\n")
    );
    expect(violations).toEqual([]);
  });

  it("skips fragments without imports unless opted in with @check", async () => {
    const { projectRoot, srcDir } = await createTypecheckProject();
    const skipped = await lintWithTypecheck(
      projectRoot,
      srcDir,
      "```ts\nconst x: number = definitelyNotDeclared;\n```\n"
    );
    expect(skipped).toEqual([]);

    const optedIn = await lintWithTypecheck(
      projectRoot,
      srcDir,
      "```ts\n// @check\nconst x: number = definitelyNotDeclared;\n```\n"
    );
    expect(optedIn).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("definitelyNotDeclared"),
      }),
    ]);
  });

  it("honors @noErrors even for module-shaped snippets", async () => {
    const { projectRoot, srcDir } = await createTypecheckProject();
    const violations = await lintWithTypecheck(
      projectRoot,
      srcDir,
      [
        "```ts",
        "// @noErrors",
        'import { gone } from "fakepkg";',
        "```",
        "",
      ].join("\n")
    );
    expect(violations).toEqual([]);
  });
});
