# Package-docs benchmark — bundled docs vs no bundle

- **Run:** `2026-05-31-package`
- **Generated:** 2026-05-31T23:35:20.981Z
- **Judge:** `deepseek/deepseek-v4-pro`
- **Candidate models:** `anthropic/claude-haiku-4.5`, `anthropic/claude-opus-4.8`, `google/gemini-3.5-flash`, `moonshotai/kimi-k2.6`, `openai/gpt-5.5`
- **Runs per cell:** 10
- **Total agent runs:** 1200

## Headline: does bundling docs lift task success?

Pass = an independent LLM judge marked the agent's answer correct against the fixture rubric. **Treatment** = the leadtype package ships its bundled `AGENTS.md` + `docs/`. **Control** = those files are stripped from the installed package, so the agent must fall back to training data. Delta is the bundled docs' value, in points.

### Per model, pooled across fixtures

| Model | Treatment | Control | Delta |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 87% [76–93%] (52/60) | 70% [57–80%] (42/60) | +17% |
| `anthropic/claude-opus-4.8` | 98% [91–100%] (59/60) | 92% [82–96%] (55/60) | +7% |
| `google/gemini-3.5-flash` | 100% [94–100%] (60/60) | 85% [74–92%] (51/60) | +15% |
| `moonshotai/kimi-k2.6` | 98% [91–100%] (59/60) | 95% [86–98%] (57/60) | +3% |
| `openai/gpt-5.5` | 98% [91–100%] (59/60) | 87% [76–93%] (52/60) | +12% |

### Arm decomposition — pooled pass rate per model

Increasing information left to right: **bare** (no package installed (pure memory)) → **control** (package, docs stripped) → **treatment** (bundle present (organic discovery)) → **pointer** (bundle + recommended root pointer).

| Model | bare | control | treatment | pointer |
| --- | --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 22% (13/60) | 70% (42/60) | 87% (52/60) | 93% (56/60) |
| `anthropic/claude-opus-4.8` | 87% (52/60) | 92% (55/60) | 98% (59/60) | 100% (60/60) |
| `google/gemini-3.5-flash` | 78% (47/60) | 85% (51/60) | 100% (60/60) | 98% (59/60) |
| `moonshotai/kimi-k2.6` | 88% (53/60) | 95% (57/60) | 98% (59/60) | 98% (59/60) |
| `openai/gpt-5.5` | 90% (54/60) | 87% (52/60) | 98% (59/60) | 98% (59/60) |

### Per fixture × model

| Fixture | Model | Treatment | Control | Delta | Used bundle (treatment) | Mean score |
| --- | --- | --- | --- | --- | --- | --- |
| bundle-rationale | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 100 |
| bundle-rationale | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| bundle-rationale | `google/gemini-3.5-flash` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| bundle-rationale | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| bundle-rationale | `openai/gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| custom-generate-script | `anthropic/claude-haiku-4.5` | 80% [49–94%] | 90% [60–98%] | -10% | 70% | 94 |
| custom-generate-script | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| custom-generate-script | `google/gemini-3.5-flash` | 100% [72–100%] | 80% [49–94%] | +20% | 70% | 100 |
| custom-generate-script | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 90% | 100 |
| custom-generate-script | `openai/gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| explain-cli-flag | `anthropic/claude-haiku-4.5` | 90% [60–98%] | 100% [72–100%] | -10% | 100% | 90 |
| explain-cli-flag | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 50% | 100 |
| explain-cli-flag | `google/gemini-3.5-flash` | 100% [72–100%] | 100% [72–100%] | +0% | 60% | 100 |
| explain-cli-flag | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| explain-cli-flag | `openai/gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 100 |
| mounted-changelog-urls | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `google/gemini-3.5-flash` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 100 |
| mounted-changelog-urls | `moonshotai/kimi-k2.6` | 90% [60–98%] | 100% [72–100%] | -10% | 100% | 99 |
| mounted-changelog-urls | `openai/gpt-5.5` | 100% [72–100%] | 80% [49–94%] | +20% | 100% | 100 |
| nav-unknown-group | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 20% [6–51%] | +80% | 100% | 100 |
| nav-unknown-group | `anthropic/claude-opus-4.8` | 90% [60–98%] | 100% [72–100%] | -10% | 100% | 90 |
| nav-unknown-group | `google/gemini-3.5-flash` | 100% [72–100%] | 60% [31–83%] | +40% | 100% | 100 |
| nav-unknown-group | `moonshotai/kimi-k2.6` | 100% [72–100%] | 70% [40–89%] | +30% | 100% | 100 |
| nav-unknown-group | `openai/gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| search-when-embeddings | `anthropic/claude-haiku-4.5` | 50% [24–76%] | 30% [11–60%] | +20% | 100% | 79 |
| search-when-embeddings | `anthropic/claude-opus-4.8` | 100% [72–100%] | 50% [24–76%] | +50% | 100% | 100 |
| search-when-embeddings | `google/gemini-3.5-flash` | 100% [72–100%] | 80% [49–94%] | +20% | 100% | 100 |
| search-when-embeddings | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| search-when-embeddings | `openai/gpt-5.5` | 90% [60–98%] | 40% [17–69%] | +50% | 100% | 90 |

## Efficiency — does bundling docs change run cost?

Per model, pooled across fixtures: average total tokens, tool calls, and wall-clock per run. Δ is treatment relative to control (negative = bundling docs made runs *cheaper*). Reading a short bundled doc can replace a flurry of exploratory `grep`/`read` calls, or it can add an upfront read — this shows which way it nets out.

| Model | Tokens (T → C, Δ) | Tool calls (T → C, Δ) | Time (T → C, Δ) |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 17.1k → 33.9k (-50%) | 13.7 → 20.6 (-33%) | 27.9s → 44.1s (-37%) |
| `anthropic/claude-opus-4.8` | 20.5k → 40.7k (-50%) | 9.3 → 14.3 (-35%) | 36.9s → 62.4s (-41%) |
| `google/gemini-3.5-flash` | 20.6k → 34.7k (-41%) | 12.7 → 23.0 (-45%) | 35.7s → 68.5s (-48%) |
| `moonshotai/kimi-k2.6` | 24.0k → 41.5k (-42%) | 14.9 → 19.8 (-25%) | 45.5s → 72.1s (-37%) |
| `openai/gpt-5.5` | 31.6k → 37.8k (-16%) | 14.3 → 15.3 (-7%) | 43.1s → 56.7s (-24%) |

## Failure modes — do docs cut *confidently wrong* answers?

Share of runs the judge marked **confidently wrong** (asserts something false with no hedging) — the most dangerous failure. Control vs treatment, pooled across fixtures; lower is better.

| Model | Confident-wrong: control → treatment |
| --- | --- |
| `anthropic/claude-haiku-4.5` | 28% → 10% |
| `anthropic/claude-opus-4.8` | 7% → 0% |
| `google/gemini-3.5-flash` | 8% → 0% |
| `moonshotai/kimi-k2.6` | 3% → 2% |
| `openai/gpt-5.5` | 8% → 0% |

## Recommended setup — root AGENTS.md pointer (`pointer` arm)

`treatment` makes the agent *discover* the bundle; `pointer` seeds leadtype's recommended root `AGENTS.md` that points at it. Bundle-read rate shows whether the pointer changes how often the agent actually reads the docs.

| Model | Pointer | Treatment | Control | Δ vs control | Δ vs treatment | Bundle read (pointer) |
| --- | --- | --- | --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 93% [84–97%] (56/60) | 87% | 70% | +23% | +7% | 92% |
| `anthropic/claude-opus-4.8` | 100% [94–100%] (60/60) | 98% | 92% | +8% | +2% | 90% |
| `google/gemini-3.5-flash` | 98% [91–100%] (59/60) | 100% | 85% | +13% | -2% | 92% |
| `moonshotai/kimi-k2.6` | 98% [91–100%] (59/60) | 98% | 95% | +3% | +0% | 97% |
| `openai/gpt-5.5` | 98% [91–100%] (59/60) | 98% | 87% | +12% | +0% | 100% |

_Judge note: no candidate model graded its own output (no self-preference bias)._
