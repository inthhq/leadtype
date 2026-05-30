import type { LlmsVariant } from "./llms-variants";

export type ToolCall = {
  tool: "read" | "write" | "list" | "glob" | "grep" | "npm";
  args: Record<string, unknown>;
  resultSummary?: string;
  /**
   * True when the tool threw (e.g. a `read` of a path that doesn't exist).
   * Metrics that count "the agent read our docs" must ignore failed calls —
   * in control mode the bundle is deleted, so the agent's attempt to read it
   * throws ENOENT and must NOT count as bundle usage.
   */
  isError?: boolean;
  durationMs: number;
};

/**
 * Package-benchmark arms:
 * - `treatment` — the bundle ships in node_modules; the agent must *discover*
 *   it by exploring (no pointer). The conservative "does it help if found" test.
 * - `control` — the bundle is stripped; the agent falls back to compiled code,
 *   types, README, and prior knowledge.
 * - `pointer` — treatment PLUS leadtype's *recommended* setup: a root AGENTS.md
 *   that tells the agent to read node_modules/leadtype/AGENTS.md first. Measures
 *   the documented happy path rather than organic discovery.
 */
export type Mode = "treatment" | "control" | "pointer";
export type Provider = "anthropic" | "openai" | "google";
export type Benchmark = "package" | "llms";

export type Transcript = {
  fixture: string;
  benchmark?: Benchmark;
  mode: Mode;
  variant?: LlmsVariant;
  agent: { provider: Provider; model: string };
  toolCalls: ToolCall[];
  filesModified: string[];
  finalText: string;
  durationMs: number;
  steps: number;
  errors: string[];
  tokens: { input: number; output: number };
};
