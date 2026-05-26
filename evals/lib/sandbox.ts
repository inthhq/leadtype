import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "tinyglobby";
import type { Mode } from "./transcript";

const evalsRoot = fileURLToPath(new URL("..", import.meta.url));

export function findLeadtypeTarball(): string {
  const tarballDir = path.join(evalsRoot, ".tarballs");
  if (!existsSync(tarballDir)) {
    throw new Error(
      `Run 'bun run pack-leadtype' before evals — no tarballs at ${tarballDir}`
    );
  }
  const tarball = readdirSync(tarballDir).find(
    (name) => name.startsWith("leadtype-") && name.endsWith(".tgz")
  );
  if (!tarball) {
    throw new Error(`No leadtype-*.tgz found in ${tarballDir}`);
  }
  return path.join(tarballDir, tarball);
}

export type SandboxHandle = {
  tempDir: string;
  cleanup: () => Promise<void>;
};

// Every package sandbox needs the same installed `node_modules/leadtype` (the
// fixtures declare no other deps). Installing it 480× dominates wall-clock, so
// install once into a template and copy-on-write clone it per sandbox.
// Memoized as a promise so concurrent callers share a single install.
let templatePromise: Promise<string> | undefined;

function prepareTemplate(): Promise<string> {
  if (!templatePromise) {
    templatePromise = (async () => {
      const tarball = findLeadtypeTarball();
      const dir = await mkdtemp(path.join(tmpdir(), "leadtype-template-"));
      await npmInstall(dir, tarball);
      return dir;
    })();
  }
  return templatePromise;
}

function cloneNodeModules(templateDir: string, tempDir: string): Promise<void> {
  const src = path.join(templateDir, "node_modules");
  const dest = path.join(tempDir, "node_modules");
  // macOS APFS clonefile (`-c`) is a near-instant copy-on-write; elsewhere fall
  // back to a plain recursive copy. Either way, deletes in the clone (control
  // mode) don't touch the template.
  const args =
    process.platform === "darwin" ? ["-cR", src, dest] : ["-R", src, dest];
  return new Promise<void>((resolveCp, rejectCp) => {
    const proc = spawn("cp", args);
    let stderr = "";
    proc.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    proc.on("error", rejectCp);
    proc.on("close", (code) => {
      if (code === 0) {
        resolveCp();
      } else {
        rejectCp(new Error(`cp node_modules exited ${code}\n${stderr}`));
      }
    });
  });
}

/**
 * Create a tempdir, copy the fixture's starter files in (PROMPT/EVAL/RUBRIC are
 * excluded — they belong to the harness, and RUBRIC.md would leak the answer),
 * provision `node_modules/leadtype`, and (in control mode) strip the bundled
 * docs the agent would otherwise discover.
 */
export async function createSandbox(options: {
  fixtureDir: string;
  mode: Mode;
}): Promise<SandboxHandle> {
  const { fixtureDir, mode } = options;
  const tempDir = await mkdtemp(path.join(tmpdir(), "leadtype-eval-"));

  try {
    await cp(fixtureDir, tempDir, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return (
          base !== "PROMPT.md" && base !== "EVAL.ts" && base !== "RUBRIC.md"
        );
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to copy fixture ${fixtureDir} → ${tempDir}: ${message}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }

  // Clone the prepared install; fall back to a direct install if cloning fails
  // (e.g. clonefile unsupported on the volume).
  try {
    const templateDir = await prepareTemplate();
    await cloneNodeModules(templateDir, tempDir);
  } catch {
    await npmInstall(tempDir, findLeadtypeTarball());
  }

  if (mode === "control") {
    const pkgRoot = path.join(tempDir, "node_modules", "leadtype");
    await rm(path.join(pkgRoot, "AGENTS.md"), { force: true });
    await rm(path.join(pkgRoot, "docs"), { force: true, recursive: true });
    // Source maps embed the full original TypeScript source and comments — a
    // back door to the same prose that lives in the bundled docs. A package
    // that simply doesn't ship agent docs wouldn't hand the agent its
    // commented source either, so strip them to keep "control" honest. The
    // compiled JS (with --help strings) and .d.ts types stay: those are real
    // package contents an agent legitimately has.
    const maps = await glob("dist/**/*.map", { cwd: pkgRoot, absolute: true });
    await Promise.all(maps.map((mapFile) => rm(mapFile, { force: true })));
  }

  return {
    tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

function npmInstall(tempDir: string, tarball: string): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    const proc = spawn("npm", ["install", tarball], {
      cwd: tempDir,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        NPM_CONFIG_LOGLEVEL: "error",
        HOME: tempDir,
      },
    });
    let stderr = "";
    proc.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    proc.on("error", rejectSpawn);
    proc.on("close", (code) => {
      if (code === 0) {
        resolveSpawn();
      } else {
        rejectSpawn(new Error(`npm install exited ${code}\n${stderr}`));
      }
    });
  });
}
