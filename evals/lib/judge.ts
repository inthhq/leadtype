import { gateway, generateObject } from "ai";
import { z } from "zod";
import { namespaceModelId } from "./models";
import { withRetry } from "./retry";

// Neutral judge: outside every candidate family. The candidate set now spans
// Anthropic, OpenAI, Google (Gemini), and Moonshot (Kimi), so the judge can't
// be any of those without self-preference bias (see the Opus-judge bias we
// found earlier). deepseek-v4-pro is a strong, current model from a family with
// no candidate — and it discriminates (passes correct answers, fails wrong
// ones) in validation. Cross-validate headline numbers with a second neutral
// judge via `rejudge --judge xai/grok-4.3`.
const DEFAULT_JUDGE_MODEL = "deepseek/deepseek-v4-pro";
const MAX_ARTIFACT_CHARS = 8000;
const MAX_ANSWER_CHARS = 16_000;

const FAILURE_MODES = [
  "none",
  "confident_wrong",
  "uncertain",
  "refused",
] as const;

export type FailureMode = (typeof FAILURE_MODES)[number];

const verdictSchema = z.object({
  correct: z
    .boolean()
    .describe(
      "True only if the response satisfies every REQUIRED rubric point."
    ),
  score: z
    .number()
    .min(0)
    .max(100)
    .describe(
      "0–100 quality score reflecting how completely the rubric is met."
    ),
  failureMode: z
    .enum(FAILURE_MODES)
    .describe(
      "How the response went wrong. 'none' if correct. 'confident_wrong' = states something the rubric marks false, with no hedging. 'uncertain' = wrong/incomplete but hedges or flags doubt. 'refused' = declines, says it can't tell, or is empty/off-topic."
    ),
  reasoning: z
    .string()
    .describe(
      "2–4 sentences: which required points were met or missed, and why."
    ),
});

export type JudgeVerdict = {
  correct: boolean;
  score: number;
  /** Undefined only when the judge call itself failed (see the catch below). */
  failureMode?: FailureMode;
  reasoning: string;
  judgeModel: string;
  error?: string;
};

export type JudgeArtifact = { path: string; content: string };

const JUDGE_SYSTEM = `You are a strict, impartial grader for an evaluation that measures whether a coding agent completed a task correctly.

You will receive: the TASK the agent was given, a RUBRIC describing exactly what a correct response must establish (this is the ground truth — trust it over your own prior knowledge), and the agent's RESPONSE (its final answer and/or the files it produced).

Grade ONLY against the rubric:
- Mark "correct": true only when every point the rubric marks REQUIRED is satisfied. Missing or wrong on any required point → "correct": false.
- Ignore writing style, length, and formatting unless the rubric requires them.
- Do not reward an answer for naming the right keywords if it states something factually wrong about them.
- If the response is empty, refuses, or is unrelated to the task, it is incorrect with a low score.
- "score" is a 0–100 measure of completeness against the rubric, independent of the pass/fail boolean.

Also classify "failureMode":
- "none" — the response is correct.
- "confident_wrong" — it asserts something the rubric marks as false, stated plainly with no hedging. (The dangerous case: a confidently wrong answer about the API.)
- "uncertain" — wrong or incomplete, but it hedges, flags doubt, or says it is unsure.
- "refused" — it declines, says it cannot determine the answer, or is empty/off-topic.
Judge the failure mode by how the answer is *expressed*, not by whether docs were available.`;

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

function buildPrompt(opts: {
  task: string;
  rubric: string;
  answer: string;
  artifacts: JudgeArtifact[];
}): string {
  const sections = [
    `## TASK\n${opts.task.trim()}`,
    `## RUBRIC (ground truth)\n${opts.rubric.trim()}`,
  ];

  const answer = opts.answer.trim();
  sections.push(
    `## AGENT RESPONSE (final summary / answer)\n${
      answer.length > 0
        ? truncate(answer, MAX_ANSWER_CHARS)
        : "(the agent produced no final text)"
    }`
  );

  if (opts.artifacts.length > 0) {
    const files = opts.artifacts
      .map(
        (file) =>
          `### FILE: ${file.path}\n\`\`\`\n${truncate(file.content, MAX_ARTIFACT_CHARS)}\n\`\`\``
      )
      .join("\n\n");
    sections.push(`## FILES THE AGENT PRODUCED OR MODIFIED\n${files}`);
  }

  return sections.join("\n\n");
}

/**
 * Grade one agent response against a fixture rubric with an LLM judge.
 * Never throws — a model/transport failure is returned as an incorrect
 * verdict carrying the error string, so a flaky judge call fails closed
 * (counts as a miss) instead of crashing the whole matrix.
 */
export async function judgeAnswer(opts: {
  task: string;
  rubric: string;
  answer: string;
  artifacts?: JudgeArtifact[];
  judgeModel?: string;
}): Promise<JudgeVerdict> {
  const judgeModel = opts.judgeModel ?? DEFAULT_JUDGE_MODEL;
  const namespaced = namespaceModelId(judgeModel);
  try {
    const { object } = await withRetry(() =>
      generateObject({
        model: gateway(namespaced),
        schema: verdictSchema,
        temperature: 0,
        system: JUDGE_SYSTEM,
        prompt: buildPrompt({
          task: opts.task,
          rubric: opts.rubric,
          answer: opts.answer,
          artifacts: opts.artifacts ?? [],
        }),
      })
    );
    return { ...object, judgeModel };
  } catch (err) {
    return {
      correct: false,
      score: 0,
      reasoning: "judge call failed — counted as a miss",
      judgeModel,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export { DEFAULT_JUDGE_MODEL };
