import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

const TRANSCRIPT_FILENAME = "transcript.json";

export function transcriptPathFor(tempDir: string): string {
  return path.join(tempDir, "__transcript__", TRANSCRIPT_FILENAME);
}

export async function writeTranscript(
  tempDir: string,
  transcript: Transcript
): Promise<string> {
  const target = transcriptPathFor(tempDir);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(transcript, null, 2)}\n`, "utf-8");
  return target;
}

/**
 * Read the transcript from the path advertised by the harness.
 * EVAL.ts files use this; they receive TRANSCRIPT_PATH as an env var.
 */
export async function readTranscript(): Promise<Transcript> {
  const fromEnv = process.env.TRANSCRIPT_PATH;
  if (!fromEnv) {
    throw new Error(
      "TRANSCRIPT_PATH env var is not set. EVAL.ts must be run via the harness, which sets it."
    );
  }
  const raw = await readFile(fromEnv, "utf-8");
  return JSON.parse(raw) as Transcript;
}
