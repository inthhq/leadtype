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
  /**
   * How a failed answer went wrong, per the judge. The headline value of docs
   * is cutting `confident_wrong`. Undefined when the judge call itself errored.
   * (Mirrors FailureMode in lib/judge.ts; inlined to keep this schema flat.)
   */
  failureMode?: "none" | "confident_wrong" | "uncertain" | "refused";

  /** Supporting mechanism metrics (not the pass gate). */
  discoveredAgentsMd?: boolean;
  readBundledDocs?: boolean;
  /** Read AGENTS.md or any bundled docs/ file — i.e. used the bundle at all. */
  usedBundle?: boolean;
  contextMatched?: boolean;
  wrongGroupReads?: number;
  /**
   * llms discovery arm only: did the agent consult `/llms.txt` *without being
   * told to*? (In the routing variants the system prompt says "start at
   * /llms.txt"; the discovery arm drops that hint and measures whether the
   * agent finds the convention on its own.)
   */
  discoveredLlmsTxt?: boolean;

  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  steps: number;
  errors: string[];
};
