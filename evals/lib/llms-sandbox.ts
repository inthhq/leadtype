import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type LlmsVariant,
  materializeDiscoveryRoot,
  materializeLlmsVariant,
} from "./llms-variants";

const ROOT_FIXTURE_FILES = new Set([
  "PROMPT.md",
  "EVAL.ts",
  "expected.json",
  "RUBRIC.md",
]);

export type LlmsSandboxHandle = {
  tempDir: string;
  cleanup: () => Promise<void>;
};

export async function createLlmsSandbox(options: {
  fixtureDir: string;
  /** Routing variant to materialize. Ignored when `discovery` is set. */
  variant?: LlmsVariant;
  /** Materialize a realistic web root with no "start at llms.txt" hint. */
  discovery?: boolean;
}): Promise<LlmsSandboxHandle> {
  const { fixtureDir, variant, discovery } = options;
  const tempDir = await mkdtemp(path.join(tmpdir(), "leadtype-llms-eval-"));

  try {
    await cp(fixtureDir, tempDir, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(fixtureDir, src);
        const isRootFixtureFile = rel !== "" && path.dirname(rel) === ".";
        return !(
          isRootFixtureFile && ROOT_FIXTURE_FILES.has(path.basename(rel))
        );
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to copy fixture ${fixtureDir} -> ${tempDir}: ${message}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }

  if (discovery) {
    await materializeDiscoveryRoot({ tempDir });
  } else if (variant) {
    await materializeLlmsVariant({ tempDir, variant });
  } else {
    throw new Error(
      "createLlmsSandbox needs a variant unless discovery is set"
    );
  }

  return {
    tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}
