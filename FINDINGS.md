# Do bundled docs actually help coding agents? What our evals found

**TL;DR — Bundling agent-readable docs into a package lifts coding-agent task success on every model we tested (+5 to +25 points), most for smaller models and most where the library behaves in non-obvious ways. The biggest win isn't getting more answers right — it's stopping agents from confidently guessing *wrong*.**

These results come from two harnesses in [`evals/`](./evals). Both run real coding agents (Claude Haiku/Sonnet/Opus 4.x and GPT‑5.5) against generated artifacts and grade the **answer** with an independent LLM judge (Opus, against a per-fixture rubric) — not by keyword matching. Run: `2026-05-25`, **4 models × 10 runs per cell**, pass rates reported with Wilson 95% confidence intervals. Full numbers in [`docs/reference/evals.mdx`](./docs/reference/evals.mdx) and `evals/results/*/report.md`.

---

## Finding 1 — Bundling docs helps, and the weaker the model the more it helps

We A/B test the same installed package with and without its bundled docs:

- **Treatment** — `node_modules/leadtype/` ships `AGENTS.md` + `docs/*.md`.
- **Control** — those files are stripped (plus `dist/*.map` source maps, which would leak the original commented source). The compiled JS — including the CLI's `--help` text — and the `.d.ts` types stay. This is an honest "a package that simply didn't bundle agent docs," not "an agent with no information."

| Model | With bundled docs | Without (control) | Lift |
| --- | --- | --- | --- |
| `claude-haiku-4-5` | 100% | 75% | **+25 pts** |
| `claude-sonnet-4-6` | 100% | 85% | **+15 pts** |
| `gpt-5.5` | 98% | 88% | **+10 pts** |
| `claude-opus-4-7` | 100% | 95% | **+5 pts** |

The lift is monotonic in model weakness. Practically: bundling pays off most for the smaller, cheaper models a large share of coding agents run on — and it still helps the frontier model.

## Finding 2 — The lift is concentrated, not uniform

Averages hide the mechanism. Per task:

- **Non-obvious behavior is where docs win big.** *"What happens if a page declares a `group` the config doesn't know?"* — control passed just **10% (Sonnet) / 20% (Haiku)**; with docs, **100%**. This one behavioral gotcha drives most of the aggregate lift.
- **Prose-only specifics matter.** The *thresholds* for when to add search embeddings live only in prose — GPT‑5.5 control **50%** → treatment **100%**.
- **Weak models need docs for what strong models infer.** API call-ordering and the bundle rationale lifted Haiku **+30 / +20**, but Sonnet/Opus/GPT got them right unaided.
- **Self-documenting tasks get ~0 lift.** Explaining a CLI flag, or a documented `--docs-dir` mount syntax, sat at **0 across all four models** — those answers are baked into the compiled CLI's `--help`, so docs add nothing. We keep these in the suite on purpose: they prove the result isn't cherry-picked, and they pin down where bundling *doesn't* pay.

## Finding 3 — The real value: docs prevent *confident wrong answers*

The dangerous failure mode isn't "the agent says it doesn't know." It's the control runs **confidently asserting the opposite of the truth** (judge scores ~15/100 on the unknown-group task). Bundling docs is cheap insurance against an agent hallucinating plausible-but-wrong behavior about your library. That, more than the raw pass-rate bump, is the argument for shipping them.

## Finding 4 — A well-built package already gets agents far

Control wasn't helpless: a self-documenting CLI, good `.d.ts` types, and a clear README let capable models recover conventional flag/config answers on their own. So the honest framing is: **bundled docs are decisive for conceptual and gotcha knowledge that can't live in a type signature or a help string; they're optional for facts your tooling already exposes.** Bundle docs to teach behavior, not to restate your `--help`.

## Finding 5 — For hosted docs, the *shape* of `llms.txt` matters — but watch the right metric

We also tested five `/llms.txt` layouts. Pass rate saturates (95–100% everywhere — small corpus, models often answer from the `/llms.txt` summary alone), so the discriminating metric is **context match**: did the agent actually follow the path the shape intends?

| Shape | Context match (across models) | Verdict |
| --- | --- | --- |
| Page-level `.md` links | **82–100%** | Agents follow it reliably |
| Root `llms-full.txt` monolith | **77–100%** | Reliable broad fallback |
| Section `llms.txt` indexes | **75–88%** | Solid, but more public artifacts |
| Explicit group bundles | **8–35%** | Agents bypass the intended links |
| Root `llms-full.txt` router | **7–40%** | Agents bypass the intended links |

`explicit-bundles` and `router` look fine on pass rate but agents don't follow them — they read the wrong group bundle ~0.6–1.8 times per run. This **validates the current default**: `/llms.txt` → page-level markdown first, `/llms-full.txt` as the broad fallback; groups organize navigation, not per-group context files.

## Finding 6 — A methodological lesson

Grading "did the agent read our file" conflates *using the docs* with *succeeding*; grading pass rate alone rewards answers from prior knowledge. You need **both** — an independent judge on the answer *plus* a separate read-path signal — or the treatment/control and variant comparisons mean nothing.

---

## Caveats (so we don't overclaim)

- **Small corpus.** Hosted-docs pass rate saturates; the monolith's edge could erode on a large docs set (token cost / truncation), which is why the grouped and section-index variants stay in the harness for a larger-corpus rerun.
- **Judge overlap.** Opus is both a candidate and the judge, so its (small) +5 row is partly self-graded. A GPT‑5.5 cross-judge would remove that asterisk.
- **n = 10 per cell.** Enough to separate the large effects (the `nav-unknown-group` intervals don't overlap), not enough to split hairs between, say, page-links and monolith.

## Reproduce

```bash
cd evals
bun install && bun run pack-leadtype
bun run evals:full       # package benchmark, 4 models × 10 runs
bun run evals:llms:full  # hosted-docs benchmark, 4 models × 10 runs
```

Every run archives `summary.json`, `report.md`, and per-run `record.json`; full transcripts and judge verdicts are in each run's `transcripts.tgz`.
