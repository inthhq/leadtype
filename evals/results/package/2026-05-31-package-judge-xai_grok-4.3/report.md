# Package-docs benchmark — bundled docs vs no bundle

- **Run:** `2026-05-31-package-judge-xai_grok-4.3`
- **Generated:** 2026-06-01T09:43:45.707Z
- **Judge:** `xai/grok-4.3`
- **Candidate models:** `anthropic/claude-haiku-4.5`, `anthropic/claude-opus-4.8`, `google/gemini-3.5-flash`, `moonshotai/kimi-k2.6`, `openai/gpt-5.5`
- **Runs per cell:** 10
- **Total agent runs:** 600

## Headline: does bundling docs lift task success?

Pass = an independent LLM judge marked the agent's answer correct against the fixture rubric. **Treatment** = the leadtype package ships its bundled `AGENTS.md` + `docs/`. **Control** = those files are stripped from the installed package, so the agent must fall back to training data. Delta is the bundled docs' value, in points.

### Per model, pooled across fixtures

| Model | Treatment | Control | Delta |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 100% [94–100%] (60/60) | 73% [61–83%] (44/60) | +27% |
| `anthropic/claude-opus-4.8` | 100% [94–100%] (60/60) | 100% [94–100%] (60/60) | +0% |
| `google/gemini-3.5-flash` | 100% [94–100%] (60/60) | 92% [82–96%] (55/60) | +8% |
| `moonshotai/kimi-k2.6` | 98% [91–100%] (59/60) | 97% [89–99%] (58/60) | +2% |
| `openai/gpt-5.5` | 100% [94–100%] (60/60) | 93% [84–97%] (56/60) | +7% |

### Per fixture × model

| Fixture | Model | Treatment | Control | Delta | Used bundle (treatment) | Mean score |
| --- | --- | --- | --- | --- | --- | --- |
| bundle-rationale | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 96 |
| bundle-rationale | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 96 |
| bundle-rationale | `google/gemini-3.5-flash` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 95 |
| bundle-rationale | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 99 |
| bundle-rationale | `openai/gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 97 |
| custom-generate-script | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 90% [60–98%] | +10% | 70% | 90 |
| custom-generate-script | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 98 |
| custom-generate-script | `google/gemini-3.5-flash` | 100% [72–100%] | 90% [60–98%] | +10% | 70% | 95 |
| custom-generate-script | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 90% | 96 |
| custom-generate-script | `openai/gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 96 |
| explain-cli-flag | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| explain-cli-flag | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 50% | 98 |
| explain-cli-flag | `google/gemini-3.5-flash` | 100% [72–100%] | 100% [72–100%] | +0% | 60% | 99 |
| explain-cli-flag | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 98 |
| explain-cli-flag | `openai/gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 99 |
| mounted-changelog-urls | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `google/gemini-3.5-flash` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 100 |
| mounted-changelog-urls | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `openai/gpt-5.5` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 97 |
| nav-unknown-group | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 10% [2–40%] | +90% | 100% | 98 |
| nav-unknown-group | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| nav-unknown-group | `google/gemini-3.5-flash` | 100% [72–100%] | 80% [49–94%] | +20% | 100% | 99 |
| nav-unknown-group | `moonshotai/kimi-k2.6` | 90% [60–98%] | 80% [49–94%] | +10% | 100% | 96 |
| nav-unknown-group | `openai/gpt-5.5` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 98 |
| search-when-embeddings | `anthropic/claude-haiku-4.5` | 100% [72–100%] | 50% [24–76%] | +50% | 100% | 98 |
| search-when-embeddings | `anthropic/claude-opus-4.8` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| search-when-embeddings | `google/gemini-3.5-flash` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 99 |
| search-when-embeddings | `moonshotai/kimi-k2.6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| search-when-embeddings | `openai/gpt-5.5` | 100% [72–100%] | 80% [49–94%] | +20% | 100% | 100 |

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
| `anthropic/claude-haiku-4.5` | 25% → 0% |
| `anthropic/claude-opus-4.8` | 0% → 0% |
| `google/gemini-3.5-flash` | 2% → 0% |
| `moonshotai/kimi-k2.6` | 3% → 0% |
| `openai/gpt-5.5` | 2% → 0% |

_Judge note: no candidate model graded its own output (no self-preference bias)._
