import { describe, expect, it } from "vitest";
import {
  loadActivationCases,
  loadRepoSkill,
  missingActivationSignals,
  missingActivationVerbs,
  parseDecision,
  parseSkillFrontmatter,
  scoreActivation,
} from "./activation";

// The discovery format caps descriptions at 1024 characters; longer ones get
// dropped by clients, so a description that grew past the cap is a real bug.
const MAX_DESCRIPTION_LENGTH = 1024;

describe("parseSkillFrontmatter", () => {
  it("re-flows a folded description onto one line", () => {
    const parsed = parseSkillFrontmatter(
      [
        "---",
        "name: demo",
        "description: >",
        "  first line",
        "  second line",
        "---",
        "",
        "# Body",
      ].join("\n")
    );
    expect(parsed.name).toBe("demo");
    expect(parsed.description).toBe("first line second line");
  });

  it("reads an inline description", () => {
    const parsed = parseSkillFrontmatter(
      ["---", "name: demo", "description: one line only", "---", ""].join("\n")
    );
    expect(parsed.description).toBe("one line only");
  });

  it("stops at the next top-level key", () => {
    const parsed = parseSkillFrontmatter(
      [
        "---",
        "name: demo",
        "description: >",
        "  wanted text",
        "license: MIT",
        "---",
        "",
      ].join("\n")
    );
    expect(parsed.description).toBe("wanted text");
  });

  it("throws when frontmatter is absent", () => {
    expect(() => parseSkillFrontmatter("# No frontmatter")).toThrow(
      /no YAML frontmatter/
    );
  });
});

describe("the shipped leadtype skill description", () => {
  it("names the docs-authoring verbs it must route on", async () => {
    const skill = await loadRepoSkill();
    expect(missingActivationVerbs(skill.description)).toEqual([]);
  });

  it("names the repository signals that stand in for saying 'leadtype'", async () => {
    const skill = await loadRepoSkill();
    expect(missingActivationSignals(skill.description)).toEqual([]);
  });

  it("stays within the discovery description cap", async () => {
    const skill = await loadRepoSkill();
    expect(skill.description.length).toBeLessThanOrEqual(
      MAX_DESCRIPTION_LENGTH
    );
  });
});

describe("activation case set", () => {
  it("has unique ids and resolvable profiles", async () => {
    const { cases, profiles } = await loadActivationCases();
    const ids = cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of cases) {
      expect(
        profiles[entry.profile],
        `unknown profile ${entry.profile}`
      ).toBeDefined();
      expect(entry.prompt.trim().length).toBeGreaterThan(0);
      expect(entry.why.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers both directions, including a negative inside a leadtype repo", async () => {
    const { cases } = await loadActivationCases();
    const activate = cases.filter((entry) => entry.expect === "activate");
    const skip = cases.filter((entry) => entry.expect === "skip");
    expect(activate.length).toBeGreaterThanOrEqual(5);
    expect(skip.length).toBeGreaterThanOrEqual(3);
    // A repository signal alone must not be sufficient — otherwise the skill
    // would load for every task in a leadtype repo.
    expect(skip.some((entry) => entry.profile.startsWith("leadtype"))).toBe(
      true
    );
  });

  it("keeps prompts free of the word 'leadtype' on the positive side", async () => {
    const { cases } = await loadActivationCases();
    const named = cases.filter(
      (entry) =>
        entry.expect === "activate" &&
        entry.prompt.toLowerCase().includes("leadtype")
    );
    // The whole point is routing prompts that never name the tool.
    expect(named).toEqual([]);
  });
});

describe("parseDecision", () => {
  it("accepts either verdict, in any case, with surrounding space", () => {
    expect(parseDecision("ACTIVATE")).toBe("activate");
    expect(parseDecision(" skip ")).toBe("skip");
    expect(parseDecision("Activate")).toBe("activate");
  });

  it("refuses a reply that merely mentions a verdict", () => {
    // Substring matching scored this as "activate", which inflates recall and
    // deflates precision — the eval would report the number you hoped for.
    for (const reply of [
      "SKIP, not ACTIVATE",
      "I would skip this — do not activate.",
      "ACTIVATE or SKIP?",
      "",
    ]) {
      expect(() => parseDecision(reply)).toThrow(/expected exactly/);
    }
  });
});

describe("scoreActivation", () => {
  const caseFor = (id: string, expected: "activate" | "skip") => ({
    id,
    prompt: id,
    profile: "leadtype-project",
    expect: expected,
    why: "test",
  });

  it("separates precision from recall", () => {
    const score = scoreActivation([
      {
        case: caseFor("a", "activate"),
        decision: "activate",
        correct: true,
      },
      { case: caseFor("b", "activate"), decision: "skip", correct: false },
      { case: caseFor("c", "skip"), decision: "activate", correct: false },
      { case: caseFor("d", "skip"), decision: "skip", correct: true },
    ]);

    expect(score.total).toBe(4);
    expect(score.correct).toBe(2);
    expect(score.accuracy).toBe(0.5);
    expect(score.recall).toBe(0.5);
    expect(score.precision).toBe(0.5);
    expect(score.falseNegatives.map((o) => o.case.id)).toEqual(["b"]);
    expect(score.falsePositives.map((o) => o.case.id)).toEqual(["c"]);
  });

  it("reports perfect scores for an empty run rather than NaN", () => {
    const score = scoreActivation([]);
    expect(score.accuracy).toBe(0);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
  });
});
