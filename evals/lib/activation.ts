/**
 * Skill-activation eval support.
 *
 * Activation is a *routing* decision: given a prompt and a project, does a
 * client pick the leadtype skill? The only input it gets is the skill's
 * frontmatter `description`, so that string is what these evals hold to
 * account — read from the real `SKILL.md`, never a copy.
 *
 * Two layers:
 *
 *   - Deterministic (runs in CI, `activation.test.ts`): the shipped description
 *     names the verbs it must win on, and the case set stays well-formed.
 *   - Model-driven (opt-in, `run-activation-eval.ts`): a model routes each
 *     case and we score precision/recall.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = path.resolve(EVALS_ROOT, "..");

export const REPO_SKILL_PATH = path.join(
  REPO_ROOT,
  ".agents",
  "skills",
  "leadtype",
  "SKILL.md"
);

export const CASES_PATH = path.join(EVALS_ROOT, "activation", "cases.json");

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const DESCRIPTION_PATTERN = /^description:\s*(>-?|\|-?)?\s*([\s\S]*?)$/m;
const NAME_PATTERN = /^name:\s*(.+)$/m;
const NEXT_KEY_PATTERN = /^\S+:/;
const WHITESPACE_RUN = /\s+/g;

export type SkillFrontmatter = {
  name: string;
  description: string;
};

/**
 * Minimal frontmatter reader for the two fields activation depends on. The
 * repo skill uses a YAML folded block (`description: >`), so the value is
 * gathered from the indented continuation lines and re-flowed to one line —
 * which is how a client sees it.
 */
export function parseSkillFrontmatter(source: string): SkillFrontmatter {
  const matter = FRONTMATTER_PATTERN.exec(source);
  if (!matter) {
    throw new Error("SKILL.md has no YAML frontmatter block");
  }
  const block = matter[1];

  const nameMatch = NAME_PATTERN.exec(block);
  if (!nameMatch) {
    throw new Error("SKILL.md frontmatter has no `name`");
  }

  const descriptionMatch = DESCRIPTION_PATTERN.exec(block);
  if (!descriptionMatch) {
    throw new Error("SKILL.md frontmatter has no `description`");
  }

  const isFolded = Boolean(descriptionMatch[1]);
  const inline = descriptionMatch[2].trim();
  if (!isFolded) {
    return { name: nameMatch[1].trim(), description: inline };
  }

  // Folded scalar: take every indented line until the next top-level key.
  const lines = block.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.startsWith("description:"));
  const collected: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.trim().length === 0) {
      collected.push("");
      continue;
    }
    if (NEXT_KEY_PATTERN.test(line)) {
      break;
    }
    collected.push(line.trim());
  }
  return {
    name: nameMatch[1].trim(),
    description: collected.join(" ").replace(WHITESPACE_RUN, " ").trim(),
  };
}

export async function loadRepoSkill(): Promise<SkillFrontmatter> {
  return parseSkillFrontmatter(await readFile(REPO_SKILL_PATH, "utf8"));
}

/**
 * Verbs the description must name for authoring prompts to route correctly.
 * Derived from the failing prompts in the activation cases: "add a page",
 * "document this option", "rewrite the quickstart", "review these docs".
 */
export const REQUIRED_ACTIVATION_VERBS = [
  "writ", // write / writing
  "edit",
  "review",
  "maintain",
] as const;

/**
 * Repository signals the description must name, so a client can route without
 * the prompt mentioning leadtype at all.
 */
export const REQUIRED_ACTIVATION_SIGNALS = [
  "leadtype",
  "docs.config",
  "leadtype.config",
] as const;

export function missingActivationVerbs(description: string): string[] {
  const haystack = description.toLowerCase();
  return REQUIRED_ACTIVATION_VERBS.filter(
    (verb) => !haystack.includes(verb)
  ).map(String);
}

export function missingActivationSignals(description: string): string[] {
  const haystack = description.toLowerCase();
  return REQUIRED_ACTIVATION_SIGNALS.filter(
    (signal) => !haystack.includes(signal)
  ).map(String);
}

export type ActivationExpectation = "activate" | "skip";

export type ActivationProfile = {
  label: string;
  context: string;
};

export type ActivationCase = {
  id: string;
  prompt: string;
  profile: string;
  expect: ActivationExpectation;
  why: string;
};

export type ActivationCaseSet = {
  profiles: Record<string, ActivationProfile>;
  cases: ActivationCase[];
};

export async function loadActivationCases(): Promise<ActivationCaseSet> {
  const raw = await readFile(CASES_PATH, "utf8");
  return JSON.parse(raw) as ActivationCaseSet;
}

export type ActivationOutcome = {
  case: ActivationCase;
  decision: ActivationExpectation;
  correct: boolean;
};

export type ActivationScore = {
  total: number;
  correct: number;
  accuracy: number;
  /** Of the cases that should activate, how many did. */
  recall: number;
  /** Of the cases that activated, how many should have. */
  precision: number;
  falsePositives: ActivationOutcome[];
  falseNegatives: ActivationOutcome[];
};

export function scoreActivation(
  outcomes: ActivationOutcome[]
): ActivationScore {
  const falseNegatives = outcomes.filter(
    (outcome) =>
      outcome.case.expect === "activate" && outcome.decision === "skip"
  );
  const falsePositives = outcomes.filter(
    (outcome) =>
      outcome.case.expect === "skip" && outcome.decision === "activate"
  );
  const truePositives = outcomes.filter(
    (outcome) =>
      outcome.case.expect === "activate" && outcome.decision === "activate"
  ).length;
  const expectedPositives = truePositives + falseNegatives.length;
  const predictedPositives = truePositives + falsePositives.length;
  const correct = outcomes.filter((outcome) => outcome.correct).length;

  return {
    total: outcomes.length,
    correct,
    accuracy: outcomes.length === 0 ? 0 : correct / outcomes.length,
    recall: expectedPositives === 0 ? 1 : truePositives / expectedPositives,
    precision:
      predictedPositives === 0 ? 1 : truePositives / predictedPositives,
    falsePositives,
    falseNegatives,
  };
}
