/**
 * One row of evidence per agent run, written to disk as `record.json` next to
 * its transcript. The aggregator reads these back, so a crashed matrix can
 * still be summarized from whatever runs completed. Kept deliberately flat and
 * JSON-only.
 */
export type RunRecord = {
  benchmark: "package" | "llms";
  fixture: string;
  model: string;
  runIndex: number;

  /** package benchmark only */
  mode?: "treatment" | "control";
  /** llms benchmark only */
  variant?: string;

  /** Headline metric: the judge's correctness verdict. */
  passed: boolean;
  /** Judge 0–100 completeness score. */
  score: number;
  judgeModel: string;
  judgeReasoning: string;
  judgeError?: string;

  /** Supporting mechanism metrics (not the pass gate). */
  discoveredAgentsMd?: boolean;
  readBundledDocs?: boolean;
  /** Read AGENTS.md or any bundled docs/ file — i.e. used the bundle at all. */
  usedBundle?: boolean;
  contextMatched?: boolean;
  wrongGroupReads?: number;

  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  steps: number;
  errors: string[];
};
