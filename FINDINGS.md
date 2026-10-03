# Do bundled docs actually help coding agents? What our evals found

**TL;DR — Bundling agent-readable docs into a package helps coding agents, most for the small/cheap models a lot of agents actually run, and most where the library behaves in non-obvious ways. The clearest, judge-robust win: docs stop agents from confidently asserting the *wrong* behavior about your API. Frontier models often get the answer right without them — but every model, frontier ones included, spends 32–54% fewer tokens (and generally fewer tool calls) when the docs are there.**

These results come from three harnesses in [`evals/`](./evals). They run real coding agents against generated artifacts and grade the **answer** with an independent LLM judge against a per-fixture rubric — not by keyword matching. Run: `2026-05-31`. The **package** benchmark uses **5 models across 4 families** — Anthropic (Haiku 4.5 / Opus 4.8), OpenAI (GPT‑5.5), Moonshot (Kimi K2.6), Google (Gemini 3.5 Flash) — **× 4 arms × 10 runs**, graded by the neutral **`deepseek-v4-pro`** (a family with no candidate) and **cross-validated with `grok-4.3`**. The hosted-docs benchmarks use a 3-model subset (Haiku, Opus, GPT‑5.5). Pass rates carry Wilson 95% CIs. Full numbers in [`docs/reference/evals.mdx`](./docs/reference/evals.mdx) and `evals/results/*/report.md`.

---

## Finding 1 — Bundling docs helps, most for smaller models

We A/B test the same installed package with and without its bundled docs:

- **Treatment** — `node_modules/leadtype/` ships `AGENTS.md` + `docs/*.md`.
- **Control** — those files are stripped (plus `dist/*.map` source maps, which would leak the original commented source). The compiled JS — including the CLI's `--help` text — and the `.d.ts` types stay. An honest "a package that simply didn't bundle agent docs," not "an agent with no information."

| Model | With bundled docs | Without (control) | Lift |
| --- | --- | --- | --- |
| `claude-haiku-4.5` (small) | 87% | 70% | **+17 pts** |
| `gemini-3.5-flash` (small) | 100% | 85% | **+15 pts** |
| `gpt-5.5` (frontier) | 98% | 87% | +12 pts |
| `claude-opus-4.8` (frontier) | 98% | 92% | +7 pts |
| `kimi-k2.6` (frontier) | 98% | 95% | +3 pts |

The lift tracks model capability: largest for the small, cheap models a lot of coding agents run on; marginal for frontier models, which recover most answers from the package's compiled code, types, and help text on their own. **A second neutral judge (`grok-4.3`) agrees on the direction and rank order** (haiku biggest at +27, kimi smallest at +2); the small-model lifts are large under both judges, the frontier ones small under both (see Finding 9).

## Finding 2 — The lift is concentrated on non-obvious behavior

Averages hide the mechanism. Almost all of the lift comes from **two** fixtures — both behavioral gotchas the compiled package can't self-document (pooled across the 5 models):

| Fixture | Delta |
| --- | --- |
| `nav-unknown-group` — what happens on an undeclared group? | **+28** |
| `search-when-embeddings` — when is the default BM25 index enough vs. embeddings? | **+28** |
| `mounted-changelog-urls` | +6 |
| `bundle-rationale`, `custom-generate-script` | +2 |
| `explain-cli-flag` | −2 |

Conventional tasks (a CLI flag, a documented mount syntax) are recoverable from the package without prose docs. The non-obvious behavioral rules are not — and that's where docs pay off.

## Finding 3 — Decomposing the value: code vs. docs vs. memory

A `bare` arm installs **nothing** (the agent answers from pure training memory); `control` adds the compiled package; `treatment` adds the bundled docs; `pointer` adds leadtype's recommended root `AGENTS.md` pointer. The ladder per model:

| Model | bare (memory) | → control (+code) | → treatment (+docs) | → pointer |
| --- | --- | --- | --- | --- |
| `claude-haiku-4.5` | 22% | 70% | 87% | 93% |
| `gemini-3.5-flash` | 78% | 85% | 100% | 98% |
| `gpt-5.5` | 90% | 87% | 98% | 98% |
| `claude-opus-4.8` | 87% | 92% | 98% | 100% |
| `kimi-k2.6` | 88% | 95% | 98% | 98% |

Small models are nearly helpless from memory (Haiku 22%) and gain hugely from *both* the installed code (+48) and the docs (+17). Frontier models already know a lot (Opus/GPT/Kimi ~87–90% from memory alone), so docs add the final few points. This is the cleanest statement of who bundling is for.

## Finding 4 — The real value: docs prevent *confident wrong answers*

The judge classifies each failure. The dangerous one is **confidently wrong** — asserting the opposite of the truth with no hedging. Docs cut it across the board:

| Model | Confident-wrong: control → treatment |
| --- | --- |
| `claude-haiku-4.5` | 28% → **10%** |
| `claude-opus-4.8` | 7% → **0%** |
| `gemini-3.5-flash` | 8% → **0%** |
| `gpt-5.5` | 8% → **0%** |
| `kimi-k2.6` | 3% → 2% |

Without docs, models don't say "I don't know" — they make up plausible-but-wrong behavior about a non-obvious API rule. Bundling docs is cheap insurance against exactly that, and it's the most defensible reason to ship them.

## Finding 5 — Even when docs don't change the answer, they cut tokens

Pooled across fixtures, bundling docs cut the **tokens** every model spent — the agent reads one short doc instead of probing the package with repeated `grep`/`read`/`list` calls. Tokens are input + output summed across every step of the tool loop (`result.totalUsage`):

| Model | Tokens (docs → none) | Tool calls (docs → none) | Wall-clock (docs → none) |
| --- | --- | --- | --- |
| `claude-haiku-4.5` | 115.8k → 227.0k (**−49%**) | 15.1 → 18.2 (−17%) | 54.2s → 41.4s (+31%) |
| `claude-opus-4.8` | 98.8k → 215.4k (**−54%**) | 9.1 → 15.5 (−41%) | 38.5s → 71.4s (−46%) |
| `gemini-3.5-flash` | 228.1k → 422.3k (**−46%**) | 14.0 → 27.5 (−49%) | 60.5s → 136.6s (−56%) |
| `kimi-k2.6` | 153.5k → 309.3k (**−50%**) | 15.6 → 20.1 (−22%) | 52.9s → 79.9s (−34%) |
| `gpt-5.5` | 160.3k → 234.5k (**−32%**) | 14.4 → 15.5 (−7%) | 51.4s → 61.2s (−16%) |

Even GPT‑5.5, which barely needs docs for correctness, spent **32%** fewer tokens with them. Tokens pay for themselves regardless of whether docs move the pass rate. Tool calls drop for every model too. **Wall-clock is not a claim we lean on** — it tracks gateway latency more than work done and is unstable run-to-run (Haiku was *faster* with docs in an earlier run, slower here).

> **Measurement note.** These cost numbers are from a `2026-06-01` treatment-vs-control re-run after fixing a token-counting bug: the harness recorded only the final tool-loop step (`result.usage`) instead of the sum across all steps (`result.totalUsage`), undercounting per-run tokens several-fold. The fix doesn't affect any pass-rate or confident-wrong finding — those depend only on the judge's verdict.

## Finding 6 — The recommended setup (a root pointer) helps, especially small models

leadtype tells consumers to add a root `AGENTS.md` pointing at `node_modules/leadtype/AGENTS.md`. The `pointer` arm seeds exactly that. It beats organic discovery (`treatment`) and pushes bundle-read to ~90–100%:

| Model | pointer | vs control | vs treatment | bundle read (pointer) |
| --- | --- | --- | --- | --- |
| `claude-haiku-4.5` | 93% | **+23** | +7 | 92% |
| `gpt-5.5` | 98% | +12 | +0 | 100% |
| `claude-opus-4.8` | 100% | +8 | +2 | 90% |
| others | 98% | +3 to +13 | ±2 | 92–97% |

The pointer is free to ship and most helps the small models that don't reliably explore `node_modules` on their own.

## Finding 7 — For hosted docs, the *shape* of `llms.txt` matters — watch context-match

Five `/llms.txt` layouts (3-model subset). Pass rate is similar everywhere, so the discriminating metric is **context match**: did the agent follow the path the shape intends? (Judge-independent — it reads tool calls.)

| Shape | Context match | Verdict |
| --- | --- | --- |
| Page-level `.md` links | **100%** | Agents follow it reliably |
| Section `llms.txt` indexes | **88%** | Solid |
| Root `llms-full.txt` monolith | **83%** | Reliable broad fallback |
| Root `llms-full.txt` router | **28%** | Agents bypass the intended links |
| Explicit group bundles | **26%** | Agents bypass the intended links |

`router` and `explicit-bundles` look fine on pass rate but agents don't follow them. This **validates the current default**: `/llms.txt` → page-level markdown first, `/llms-full.txt` as the broad fallback; groups organize navigation, not per-group context files.

## Finding 8 — Agents rarely discover `llms.txt` on their own

The routing benchmark *tells* agents to start at `/llms.txt`. A separate **discovery** arm drops that hint and serves a realistic web root (docs pages + `llms.txt` + `llms-full.txt` + sitemap + robots). Result: agents consult `/llms.txt` only **~29% of the time unprompted** — they mostly grep the doc pages directly and still answer correctly (79% pass). The lesson: `llms.txt` earns its keep most as a *pointed-to* entry (a root `AGENTS.md`, a tool that fetches it), not as an organically-discovered one. (On `single-page-cli-flag`, agents that skipped `llms.txt` mostly failed — so the convention *would* have helped where they didn't use it.)

## Finding 9 — We cross-validated the judge

LLM judges can favor their own family, so once Gemini became a candidate we judged with `deepseek-v4-pro` (a family with no candidate) and re-graded the headline arms with a second neutral judge, `grok-4.3`:

| Lift (treatment − control) | Haiku | Gemini | GPT‑5.5 | Opus | Kimi |
| --- | --- | --- | --- | --- | --- |
| `deepseek-v4-pro` (canonical) | +17 | +15 | +12 | +7 | +3 |
| `grok-4.3` (cross-check) | **+27** | +8 | +7 | +0 | +2 |

Both neutral judges agree on the **direction and rank order**: small models gain most, frontier least. Frontier magnitudes are judge-sensitive (Opus +7 vs +0; GPT +12 vs +7) but small either way, so the qualitative claim is robust. Lesson, again: never let a judge from a candidate's family set your headline, and cross-validate the deltas you publish.

---

## Caveats (so we don't overclaim)

- **n = 10 per cell.** Enough to separate the large effects (Haiku/Gemini lifts, the two gotcha fixtures), not enough to split hairs between small frontier deltas.
- **Hosted-docs benchmarks used a 3-model subset** (Haiku/Opus/GPT‑5.5) to slim cost; the package headline used all five. Routing/discovery are model-robust, so this is a reasonable trade.
- **Kimi K2.6 was flaky on the gateway** (frequent timeouts under concurrent load); its numbers come from an isolated low-concurrency re-run. Read its small +3 with that operational caveat.
- **Frontier docs-gap is fixture-bound.** GPT/Opus/Kimi clear most tasks from the package alone; exposing a larger gap likely needs more obscure or novel API surface. A bigger, harder fixture suite — and a flattened-MDX-vs-raw-MDX arm that tests leadtype's actual thesis — are the obvious next steps.

## Reproduce

```bash
cd evals
bun install && bun run pack-leadtype
bun run evals:full:arms        # package: 5 models × bare/control/treatment/pointer × 10
bun run evals:llms:full         # hosted-docs routing (3-model subset)
bun run evals:llms:discovery    # unhinted llms.txt discovery
# Cross-validate the headline with a second neutral judge (no agents re-run):
bun run rejudge results/package/2026-05-31-package --judge xai/grok-4.3 --arms treatment,control
```

Every run archives `summary.json`, `report.md`, and per-run `record.json`; transcripts and judge verdicts sit next to each record.
