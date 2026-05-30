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

export type Mode = "treatment" | "control";
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
