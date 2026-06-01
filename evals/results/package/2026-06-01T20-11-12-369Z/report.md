# Package-docs benchmark — bundled docs vs no bundle

- **Run:** `2026-06-01T20-11-12-369Z`
- **Generated:** 2026-06-01T21:25:08.701Z
- **Judge:** `deepseek/deepseek-v4-pro`
- **Candidate models:** `anthropic/claude-haiku-4.5`, `anthropic/claude-opus-4.8`, `google/gemini-3.5-flash`, `moonshotai/kimi-k2.6`, `openai/gpt-5.5`
- **Runs per cell:** 10
- **Total agent runs:** 600

## Headline: does bundling docs lift task success?

Pass = an independent LLM judge marked the agent's answer correct against the fixture rubric. **Treatment** = the leadtype package ships its bundled `AGENTS.md` + `docs/`. **Control** = those files are stripped from the installed package, so the agent must fall back to training data. Delta is the bundled docs' value, in points.

### Per model, pooled across fixtures

| Model | Treatment | Control | Delta |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 95% [86–98%] (57/60) | 68% [56–79%] (41/60) | +27% |
| `anthropic/claude-opus-4.8` | 100% [94–100%] (60/60) | 83% [72–91%] (50/60) | +17% |
| `google/gemini-3.5-flash` | 98% [91–100%] (59/60) | 85% [74–92%] (51/60) | +13% |
| `moonshotai/kimi-k2.6` | 97% [89–99%] (58/60) | 93% [84–97%] (56/60) | +3% |
| `openai/gpt-5.5` | 98% [91–100%] (59/60) | 82% [70–89%] (49/60) | +17% |

### Per fixture × model

| Fixture | Model | Treatment | Control | Delta | Used bundle (treatment) | Mean score |
| --- | --- | --- | --- | --- | --- | --- |
| bundle-rationale | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| bundle-rationale | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| bundle-rationale | `google/gemini-3.5-flash` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| bundle-rationale | `moonshotai/kimi-k2.6` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 100 |
| bundle-rationale | `openai/gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| custom-generate-script | `anthropic/claude-haiku-4.5` | 90% [60–98%] | 70% [40–89%] | +20% | 60% | 96 |
| custom-generate-script | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| custom-generate-script | `google/gemini-3.5-flash` | 90% [60–98%] | 70% [40–89%] | +20% | 50% | 93 |
| custom-generate-script | `moonshotai/kimi-k2.6` | 80% [49–94%] | 100% [72–100%] | -20% | 70% | 93 |
| custom-generate-script | `openai/gpt-5.5` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 100 |
| explain-cli-flag | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| explain-cli-flag | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 30% | 100 |
| explain-cli-flag | `google/gemini-3.5-flash` | 100% [72–100%] | 100% [72–100%] | +0% | 60% | 100 |
| explain-cli-flag | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| explain-cli-flag | `openai/gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 90% | 100 |
| mounted-changelog-urls | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 100 |
| mounted-changelog-urls | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `google/gemini-3.5-flash` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `openai/gpt-5.5` | 90% [60–98%] | 90% [60–98%] | +0% | 100% | 99 |
| nav-unknown-group | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 10% [2–40%] | +90% | 100% | 100 |
| nav-unknown-group | `anthropic/claude-opus-4.8` | 100% [72–100%] | 70% [40–89%] | +30% | 100% | 100 |
| nav-unknown-group | `google/gemini-3.5-flash` | 100% [72–100%] | 90% [60–98%] | +10% | 90% | 100 |
| nav-unknown-group | `moonshotai/kimi-k2.6` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 100 |
| nav-unknown-group | `openai/gpt-5.5` | 100% [72–100%] | 80% [49–94%] | +20% | 100% | 100 |
| search-when-embeddings | `anthropic/claude-haiku-4.5` | 80% [49–94%] | 40% [17–69%] | +40% | 100% | 95 |
| search-when-embeddings | `anthropic/claude-opus-4.8` | 100% [72–100%] | 30% [11–60%] | +70% | 100% | 100 |
| search-when-embeddings | `google/gemini-3.5-flash` | 100% [72–100%] | 50% [24–76%] | +50% | 100% | 100 |
| search-when-embeddings | `moonshotai/kimi-k2.6` | 100% [72–100%] | 80% [49–94%] | +20% | 100% | 100 |
| search-when-embeddings | `openai/gpt-5.5` | 100% [72–100%] | 30% [11–60%] | +70% | 100% | 100 |

## Efficiency — does bundling docs change run cost?

Per model, pooled across fixtures: average total tokens, tool calls, and wall-clock per run. Δ is treatment relative to control (negative = bundling docs made runs *cheaper*). Reading a short bundled doc can replace a flurry of exploratory `grep`/`read` calls, or it can add an upfront read — this shows which way it nets out.

| Model | Tokens (T → C, Δ) | Tool calls (T → C, Δ) | Time (T → C, Δ) |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 115.8k → 227.0k (-49%) | 15.1 → 18.2 (-17%) | 54.2s → 41.4s (+31%) |
| `anthropic/claude-opus-4.8` | 98.8k → 215.4k (-54%) | 9.1 → 15.5 (-41%) | 38.5s → 71.4s (-46%) |
| `google/gemini-3.5-flash` | 228.1k → 422.3k (-46%) | 14.0 → 27.5 (-49%) | 60.5s → 136.6s (-56%) |
| `moonshotai/kimi-k2.6` | 153.5k → 309.3k (-50%) | 15.6 → 20.1 (-22%) | 52.9s → 79.9s (-34%) |
| `openai/gpt-5.5` | 160.3k → 234.5k (-32%) | 14.4 → 15.5 (-7%) | 51.4s → 61.2s (-16%) |

## Failure modes — do docs cut *confidently wrong* answers?

Share of runs the judge marked **confidently wrong** (asserts something false with no hedging) — the most dangerous failure. Control vs treatment, pooled across fixtures; lower is better.

| Model | Confident-wrong: control → treatment |
| --- | --- |
| `anthropic/claude-haiku-4.5` | 32% → 5% |
| `anthropic/claude-opus-4.8` | 15% → 0% |
| `google/gemini-3.5-flash` | 15% → 2% |
| `moonshotai/kimi-k2.6` | 5% → 3% |
| `openai/gpt-5.5` | 17% → 2% |

_Judge note: no candidate model graded its own output (no self-preference bias)._
