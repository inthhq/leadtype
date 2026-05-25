import type { LlmsVariant } from "./llms-variants";

export type ToolCall = {
  tool: "read" | "write" | "list" | "glob" | "grep" | "npm";
  args: Record<string, unknown>;
  resultSummary?: string;
  durationMs: number;
};

export type Mode = "treatment" | "control";
export type Provider = "anthropic" | "openai";
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
