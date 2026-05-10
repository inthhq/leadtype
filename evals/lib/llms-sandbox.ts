import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type LlmsVariant, materializeLlmsVariant } from "./llms-variants";

export type LlmsSandboxHandle = {
  tempDir: string;
  cleanup: () => Promise<void>;
};

export async function createLlmsSandbox(options: {
  fixtureDir: string;
  variant: LlmsVariant;
}): Promise<LlmsSandboxHandle> {
  const { fixtureDir, variant } = options;
  const tempDir = await mkdtemp(path.join(tmpdir(), "leadtype-llms-eval-"));

  try {
    await cp(fixtureDir, tempDir, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return (
          base !== "PROMPT.md" && base !== "EVAL.ts" && base !== "expected.json"
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

  await materializeLlmsVariant({ tempDir, variant });

  return {
    tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}
