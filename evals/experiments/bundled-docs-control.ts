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
 * Control experiment: leadtype is installed, but AGENTS.md and the docs/
 * directory are stripped immediately after install. The agent has to fall
 * back to its training data, the package's source code, or web search.
 *
 * Pair-compare against bundled-docs.ts — same prompts, same models, same
 * runs — to measure the lift from shipping bundled docs.
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
    // Strip the bundled docs the agent would otherwise discover.
    await sandbox.run("rm", ["-f", "node_modules/leadtype/AGENTS.md"]);
    await sandbox.run("rm", ["-rf", "node_modules/leadtype/docs"]);
  },
  timeout: 300,
  copyFiles: "changed",
} satisfies ExperimentConfig;
