import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExperimentConfig } from "@vercel/agent-eval";

const evalsRoot = fileURLToPath(new URL("..", import.meta.url));
const tarballDir = join(evalsRoot, ".tarballs");

function findLeadtypeTarball(): string {
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
  return join(tarballDir, tarball);
}

/**
 * Treatment experiment: leadtype is installed in the sandbox exactly like an
 * end user would see it. AGENTS.md and docs/*.md are present at
 * node_modules/leadtype/.
 *
 * The control experiment (bundled-docs-control.ts) is identical except it
 * deletes those files post-install. The delta between the two pass rates is
 * the discoverability lift from shipping AGENTS.md.
 */
export default {
  agent: "vercel-ai-gateway/claude-code",
  model: ["anthropic/claude-haiku-4-5", "openai/gpt-5.4-mini"],
  runs: 3,
  earlyExit: false,
  evals: [
    "wire-content-negotiation",
    "validate-in-ci",
    "explain-cli-flag",
    "bundle-own-docs",
  ],
  setup: async ({ sandbox }) => {
    const tarball = findLeadtypeTarball();
    await sandbox.writeFile("/leadtype.tgz", tarball);
    await sandbox.run("npm", ["install", "/leadtype.tgz"]);
  },
  timeout: 300,
  copyFiles: "changed",
} satisfies ExperimentConfig;
