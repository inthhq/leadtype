import { readSucceeded } from "./reads";
import type { ToolCall } from "./transcript";

const BUNDLED_AGENTS_MD = "node_modules/leadtype/AGENTS.md";
const BUNDLED_DOCS_DIR = /node_modules\/leadtype\/docs\//;

export type PackageReadSummary = {
  /** The agent successfully read the bundled `AGENTS.md` entry point. */
  discoveredAgentsMd: boolean;
  /** The agent successfully read at least one bundled `docs/*.md` file. */
  readBundledDocs: boolean;
  /** Read AGENTS.md or any bundled docs/ file — i.e. used the bundle at all. */
  usedBundle: boolean;
};

/**
 * Did the agent actually read the bundled docs? This is the package
 * benchmark's mechanism metric — supporting evidence, never the pass gate.
 *
 * Only *successful* reads count. In control mode the bundle is stripped, so a
 * read of `node_modules/leadtype/AGENTS.md` throws ENOENT; counting that
 * attempt would (wrongly) report bundle usage for a file that isn't there.
 */
export function summarizePackageReads(calls: ToolCall[]): PackageReadSummary {
  const reads = calls.filter(readSucceeded);
  const pathOf = (call: ToolCall) => String(call.args.path ?? "");
  const discoveredAgentsMd = reads.some((call) =>
    pathOf(call).includes(BUNDLED_AGENTS_MD)
  );
  const readBundledDocs = reads.some((call) =>
    BUNDLED_DOCS_DIR.test(pathOf(call))
  );
  return {
    discoveredAgentsMd,
    readBundledDocs,
    usedBundle: discoveredAgentsMd || readBundledDocs,
  };
}
