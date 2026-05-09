import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

  await cp(fixtureDir, tempDir, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== "PROMPT.md" && base !== "EVAL.ts";
    },
  });

  const tarball = findLeadtypeTarball();
  await npmInstall(tempDir, tarball);

  if (mode === "control") {
    await rm(path.join(tempDir, "node_modules", "leadtype", "AGENTS.md"), {
      force: true,
    });
    await rm(path.join(tempDir, "node_modules", "leadtype", "docs"), {
      force: true,
      recursive: true,
    });
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
