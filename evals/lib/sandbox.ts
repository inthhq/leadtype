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

/**
 * Create a tempdir, copy the fixture's starter files in (PROMPT.md and
 * EVAL.ts are excluded — they belong to the harness, not the agent's
 * project), `npm install` the leadtype tarball, and (in control mode)
 * strip the bundled docs the agent would otherwise discover.
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
        // PROMPT/EVAL/RUBRIC belong to the harness; never expose RUBRIC.md to
        // the agent or it could read the graded answer straight out of the cwd.
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

  const tarball = findLeadtypeTarball();
  await npmInstall(tempDir, tarball);

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
