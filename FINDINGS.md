# Do bundled docs actually help coding agents? What our evals found

**TL;DR — Bundling agent-readable docs into a package helps coding agents, most for smaller models and most where the library behaves in non-obvious ways. The clearest, judge-robust win: docs stop agents from confidently asserting the *wrong* behavior about your API. Frontier models often get the answer right without them — but every model, frontier ones included, runs cheaper with the docs there (15–50% fewer tokens, plus fewer tool calls and less time).**

These results come from two harnesses in [`evals/`](./evals). Both run real coding agents (Claude Haiku/Sonnet/Opus 4.x and GPT‑5.5) against generated artifacts and grade the **answer** with an independent LLM judge against a per-fixture rubric — not by keyword matching. We grade with **`gemini-3-pro`**, a neutral judge *outside* the candidate set (no Claude/GPT family), and **cross-validated every correctness headline against three judges** (see below). The efficiency numbers (Finding 4) are judge-independent — read straight from the agents' tool-call transcripts. Run: `2026-05-25`, **4 models × 10 runs per cell**, pass rates with Wilson 95% CIs. Full numbers in [`docs/reference/evals.mdx`](./docs/reference/evals.mdx) and `evals/results/*/report.md`.

---

## Finding 1 — Bundling docs helps, most for smaller models

We A/B test the same installed package with and without its bundled docs:

- **Treatment** — `node_modules/leadtype/` ships `AGENTS.md` + `docs/*.md`.
- **Control** — those files are stripped (plus `dist/*.map` source maps, which would leak the original commented source). The compiled JS — including the CLI's `--help` text — and the `.d.ts` types stay. This is an honest "a package that simply didn't bundle agent docs," not "an agent with no information."

| Model | With bundled docs | Without (control) | Lift |
| --- | --- | --- | --- |
| `claude-haiku-4-5` | 98% | 80% | **+18 pts** |
| `claude-sonnet-4-6` | 100% | 85% | **+15 pts** |
| `claude-opus-4-7` | 100% | 95% | **+5 pts** |
| `gpt-5.5` | 98% | 100% | **~0** |

The lift tracks model capability: large for the small, cheap models a lot of coding agents run on; marginal for frontier models, which recover most answers from the package's compiled code, types, and help text on their own.

## Finding 2 — The lift is concentrated on non-obvious behavior

Averages hide the mechanism. Under the neutral judge, almost all of the lift comes from **one** fixture — a behavioral gotcha:

| Fixture | Haiku | Sonnet | Opus | GPT‑5.5 |
| --- | --- | --- | --- | --- |
| `nav-unknown-group` (what happens on an undeclared group?) | **+80** | **+90** | **+30** | −10 |
| `custom-generate-script` (library API call ordering) | +20 | 0 | 0 | 0 |
| `bundle-rationale` | +10 | 0 | 0 | 0 |
| `search-when-embeddings`, `explain-cli-flag`, `mounted-changelog-urls` | 0 | 0 | 0 | 0 |

The conventional tasks (a CLI flag, a documented mount syntax, search defaults) are recoverable from the package without prose docs. The gotcha is not — and that's where docs pay off.

## Finding 3 — The real value: docs prevent *confident wrong answers*

On `nav-unknown-group`, control didn't fail by saying "I don't know" — it **confidently asserted the opposite of the truth**. Without docs, control passed just **20% (Haiku), 10% (Sonnet), 70% (even Opus)**; with docs, **100%** across the board. (GPT‑5.5 happened to know this one.) Three of four models *make up* plausible-but-wrong behavior about a non-obvious API rule when the docs aren't there. Bundling docs is cheap insurance against exactly that — and it's the most defensible reason to ship them.

## Finding 4 — Even when docs don't change the answer, they make the run cheaper

Correctness isn't the only axis. We log tokens, tool calls, and wall-clock per run. Pooled across fixtures, **bundling docs cut the cost of every model's runs** — the agent reads one short doc instead of probing the installed package with repeated `grep`/`read`/`list` calls:

| Model | Tokens (docs → none) | Tool calls (docs → none) | Wall-clock (docs → none) |
| --- | --- | --- | --- |
| `claude-haiku-4-5` | 17.0k → 31.0k (**−45%**) | 12.8 → 19.5 (−35%) | 28.7s → 43.2s (−34%) |
| `claude-sonnet-4-6` | 21.1k → 37.7k (**−44%**) | 12.8 → 18.2 (−29%) | 55.6s → 76.8s (−28%) |
| `claude-opus-4-7` | 17.1k → 34.6k (**−51%**) | 7.5 → 12.4 (−39%) | 42.3s → 68.4s (−38%) |
| `gpt-5.5` | 34.0k → 40.0k (**−15%**) | 13.4 → 14.6 (−9%) | 44.5s → 53.0s (−16%) |

This is the quiet case for bundling: even GPT‑5.5, which cleared every task without docs, spent **15% fewer tokens** with them. For the cheap models that recover correctness more slowly, no-docs runs cost ~1.8× the tokens (and ~1.5× the tool calls). Docs pay for themselves in run cost regardless of whether they move the pass rate.

## Finding 5 — We cross-validated the judge, and it changed the story

LLM judges can favor their own model family, so we re-graded all 1,680 saved answers (no agents re-run) with three judges:

| | Haiku | Sonnet | Opus | GPT‑5.5 |
| --- | --- | --- | --- | --- |
| Lift, `claude-opus-4-7` judge | +25 | +15 | +5 | **+10** |
| Lift, `gemini-3.5-flash` judge (neutral) | +18 | +15 | +5 | **~0** |
| Lift, `gemini-3-pro` judge (neutral, canonical) | +18 | +15 | +5 | **−2** |

Two independent neutral judges agree; **Opus was the outlier**. It (a) scored Claude answers a few points higher than GPT's across the board, and (b) strict-failed GPT's borderline *no-docs* answers that both Gemini judges passed — which is what inflated "GPT needs docs (+10)" into existence. With a neutral judge, **GPT‑5.5 cleared all six tasks from the package alone** (100% control), and the model-vs-model score gap disappears. Lesson: never let a judge from a candidate's family set your headline.

## Finding 6 — For hosted docs, the *shape* of `llms.txt` matters — watch context-match, not pass rate

Five `/llms.txt` layouts, judged the same way. Pass rate saturates (95–100% everywhere — small corpus, models often answer from the `/llms.txt` summary), so the discriminating metric is **context match**: did the agent actually follow the path the shape intends? (This metric reads the agent's tool calls, so it's judge-independent.)

| Shape | Context match (across models) | Verdict |
| --- | --- | --- |
| Page-level `.md` links | **82–100%** | Agents follow it reliably |
| Root `llms-full.txt` monolith | **77–100%** | Reliable broad fallback |
| Section `llms.txt` indexes | **75–88%** | Solid, but more public artifacts |
| Explicit group bundles | **8–35%** | Agents bypass the intended links |
| Root `llms-full.txt` router | **7–40%** | Agents bypass the intended links |

`explicit-bundles` and `router` look fine on pass rate but agents don't follow them (they grab the wrong group bundle ~0.6–1.8 times/run). This **validates the current default**: `/llms.txt` → page-level markdown first, `/llms-full.txt` as the broad fallback; groups organize navigation, not per-group context files.

## Finding 7 — A methodological lesson

Grading "did the agent read our file" conflates *using the docs* with *succeeding*; grading pass rate alone rewards answers from prior knowledge; and grading with a same-family judge bakes in bias. You need an **independent, neutral judge on the answer** *plus* a separate read-path signal — or the comparisons mean nothing.

---

## Caveats (so we don't overclaim)

- **Our fixtures didn't surface a docs-gap for GPT‑5.5.** It cleared all six tasks from the package alone. That doesn't mean docs never help frontier models — it means exposing a gap likely needs more obscure or novel API surface than this set has. A bigger, harder fixture suite is the obvious next step.
- **Small corpus** for hosted docs → pass saturates; the monolith's edge could erode on a large docs set, which is why the grouped/section variants stay in the harness.
- **n = 10 per cell.** Enough to separate the large effects (the `nav-unknown-group` intervals don't overlap), not enough to split hairs between, say, page-links and monolith.
- **Two of the three judge verdicts are persisted; the third is re-derivable.** The canonical `gemini-3-pro` verdict lives in each `record.json`, and the original Opus first-pass is kept inside `transcripts.tgz`. The `gemini-3.5-flash` row in Finding 5 isn't committed loose — regenerate it with `bun run rejudge … --judge gemini-3.5-flash` (no agents re-run). Efficiency numbers come straight from the saved transcripts.

## Reproduce

```bash
cd evals
bun install && bun run pack-leadtype
bun run evals:full       # package benchmark, 4 models × 10 runs (judge: gemini-3-pro)
bun run evals:llms:full  # hosted-docs benchmark, 4 models × 10 runs
# Re-grade saved answers with a different judge, no agents re-run:
bun run rejudge results/package/2026-05-25-package --judge <model>
```

Every run archives `summary.json`, `report.md`, and per-run `record.json`; full transcripts and judge verdicts are in each run's `transcripts.tgz`.
