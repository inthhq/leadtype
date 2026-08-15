#!/usr/bin/env bun
/**
 * Skill-activation routing eval.
 *
 * Asks a model to make the same call a skill-aware client makes: given the
 * leadtype skill's frontmatter description and a project's observable signals,
 * should this skill be loaded for this prompt? Scores precision and recall
 * against the labelled cases in `activation/cases.json`.
 *
 * The description under test is read from the real `.agents/skills/leadtype/SKILL.md`,
 * so narrowing it shows up here as a recall drop.
 *
 *   bun --env-file=../.env run run-activation-eval.ts
 *   bun --env-file=../.env run run-activation-eval.ts --models anthropic/claude-haiku-4.5 --runs 3
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateway, generateText } from "ai";
import {
  type ActivationCase,
  type ActivationOutcome,
  loadActivationCases,
  loadRepoSkill,
  parseDecision,
  scoreActivation,
} from "./lib/activation";
import { namespaceModelId, parseModelList } from "./lib/models";
import { runPool } from "./lib/pool";
import { withRetry } from "./lib/retry";

const DEFAULT_MODELS = ["anthropic/claude-haiku-4.5"];
const DEFAULT_RUNS = 3;
const DEFAULT_CONCURRENCY = 8;
// Bounded because both multiply into gateway load: runs multiplies the number
// of calls, concurrency multiplies how many land at once.
const MAX_RUNS = 100;
const MAX_CONCURRENCY = 64;
const PERCENT = 100;
const evalsRoot = fileURLToPath(new URL(".", import.meta.url));

type CliArgs = {
  models: string[];
  runs: number;
  concurrency: number;
  label?: string;
};

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(value: string, flag: string, max: number): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new Error(`${flag} must be between 1 and ${max}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    models: DEFAULT_MODELS,
    runs: DEFAULT_RUNS,
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--models") {
      args.models = parseModelList(readValue(argv, ++index, flag));
    } else if (flag === "--runs") {
      args.runs = parsePositiveInt(
        readValue(argv, ++index, flag),
        flag,
        MAX_RUNS
      );
    } else if (flag === "--concurrency") {
      args.concurrency = parsePositiveInt(
        readValue(argv, ++index, flag),
        flag,
        MAX_CONCURRENCY
      );
    } else if (flag === "--label") {
      args.label = readValue(argv, ++index, flag);
    } else {
      throw new Error(`unknown flag: ${flag}`);
    }
  }
  return args;
}

const SYSTEM_PROMPT = `You are the skill router inside a coding agent. Before acting on a user's request you decide which optional skills to load.

You are given one skill's discovery entry (its name and description — the only thing you can see before loading it), a description of the project the user is working in, and the user's request.

Answer with exactly one word: ACTIVATE if this skill should be loaded for this request, or SKIP if it should not. No punctuation, no explanation.`;

/**
 * Both `name` and `description` go in, because both are what a client reads
 * from the discovery manifest before loading anything. Measuring the
 * description alone would test a contract that doesn't exist.
 */
function buildPrompt(
  skill: { name: string; description: string },
  profileContext: string,
  userPrompt: string
): string {
  return [
    "Available skill:",
    `  name: ${skill.name}`,
    `  description: ${skill.description}`,
    "",
    "Project:",
    `  ${profileContext}`,
    "",
    `User request: "${userPrompt}"`,
    "",
    "ACTIVATE or SKIP?",
  ].join("\n");
}

type Cell = {
  model: string;
  run: number;
  entry: ActivationCase;
  context: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [skill, caseSet] = await Promise.all([
    loadRepoSkill(),
    loadActivationCases(),
  ]);

  const cells: Cell[] = [];
  for (const model of args.models) {
    for (let run = 0; run < args.runs; run++) {
      for (const entry of caseSet.cases) {
        const profile = caseSet.profiles[entry.profile];
        if (!profile) {
          throw new Error(
            `case "${entry.id}" references unknown profile "${entry.profile}"`
          );
        }
        cells.push({ model, run, entry, context: profile.context });
      }
    }
  }

  process.stderr.write(
    `Routing ${caseSet.cases.length} cases × ${args.models.length} model(s) × ${args.runs} run(s) = ${cells.length} calls\n`
  );

  const outcomes: ActivationOutcome[] = [];
  const byModel = new Map<string, ActivationOutcome[]>();

  await runPool(cells, args.concurrency, async (cell) => {
    const result = await withRetry(() =>
      generateText({
        model: gateway(namespaceModelId(cell.model)),
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(skill, cell.context, cell.entry.prompt),
        temperature: 0,
      })
    );
    const decision = parseDecision(result.text);
    const outcome: ActivationOutcome = {
      case: cell.entry,
      decision,
      correct: decision === cell.entry.expect,
      model: cell.model,
      run: cell.run,
    };
    outcomes.push(outcome);
    const bucket = byModel.get(cell.model) ?? [];
    bucket.push(outcome);
    byModel.set(cell.model, bucket);
  });

  const overall = scoreActivation(outcomes);
  const pct = (value: number) => `${(value * PERCENT).toFixed(1)}%`;

  process.stdout.write("\nSkill activation routing\n");
  process.stdout.write(`  skill:     ${skill.name}\n`);
  process.stdout.write(`  accuracy:  ${pct(overall.accuracy)}\n`);
  process.stdout.write(
    `  recall:    ${pct(overall.recall)} (authoring prompts that routed)\n`
  );
  process.stdout.write(
    `  precision: ${pct(overall.precision)} (activations that were wanted)\n`
  );

  for (const [model, modelOutcomes] of byModel) {
    const score = scoreActivation(modelOutcomes);
    process.stdout.write(
      `\n  ${model}: accuracy ${pct(score.accuracy)}, recall ${pct(score.recall)}, precision ${pct(score.precision)}\n`
    );
    const missedIds = [
      ...new Set(score.falseNegatives.map((outcome) => outcome.case.id)),
    ];
    const overreachIds = [
      ...new Set(score.falsePositives.map((outcome) => outcome.case.id)),
    ];
    if (missedIds.length > 0) {
      process.stdout.write(`    missed:     ${missedIds.join(", ")}\n`);
    }
    if (overreachIds.length > 0) {
      process.stdout.write(`    overreach:  ${overreachIds.join(", ")}\n`);
    }
  }

  const resultsDir = path.join(evalsRoot, "results");
  await mkdir(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(
    resultsDir,
    `activation-${args.label ?? stamp}.json`
  );
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        skill,
        models: args.models,
        runs: args.runs,
        overall: {
          total: overall.total,
          correct: overall.correct,
          accuracy: overall.accuracy,
          recall: overall.recall,
          precision: overall.precision,
        },
        outcomes: outcomes.map((outcome) => ({
          id: outcome.case.id,
          model: outcome.model,
          run: outcome.run,
          expect: outcome.case.expect,
          decision: outcome.decision,
          correct: outcome.correct,
        })),
      },
      null,
      2
    )}\n`
  );
  process.stdout.write(`\nWrote ${path.relative(evalsRoot, outPath)}\n`);
}

await main();
