# Package-docs benchmark — bundled docs vs no bundle

- **Run:** `2026-05-25-package`
- **Generated:** 2026-05-26T12:30:47.536Z
- **Judge:** `gemini-3-pro`
- **Candidate models:** `claude-haiku-4-5`, `claude-opus-4-7`, `claude-sonnet-4-6`, `gpt-5.5`
- **Runs per cell:** 10
- **Total agent runs:** 480

## Headline: does bundling docs lift task success?

Pass = an independent LLM judge marked the agent's answer correct against the fixture rubric. **Treatment** = the leadtype package ships its bundled `AGENTS.md` + `docs/`. **Control** = those files are stripped from the installed package, so the agent must fall back to training data. Delta is the bundled docs' value, in points.

### Per model, pooled across fixtures

| Model | Treatment | Control | Delta |
| --- | --- | --- | --- |
| `claude-haiku-4-5` | 98% [91–100%] (59/60) | 80% [68–88%] (48/60) | +18% |
| `claude-opus-4-7` | 100% [94–100%] (60/60) | 95% [86–98%] (57/60) | +5% |
| `claude-sonnet-4-6` | 100% [94–100%] (60/60) | 85% [74–92%] (51/60) | +15% |
| `gpt-5.5` | 98% [91–100%] (59/60) | 100% [94–100%] (60/60) | -2% |

### Per fixture × model

| Fixture | Model | Treatment | Control | Delta | Used bundle (treatment) | Mean score |
| --- | --- | --- | --- | --- | --- | --- |
| bundle-rationale | `claude-haiku-4-5` | 100% [72–100%] | 90% [60–98%] | +10% | 100% | 100 |
| bundle-rationale | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| bundle-rationale | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| bundle-rationale | `gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| custom-generate-script | `claude-haiku-4-5` | 90% [60–98%] | 70% [40–89%] | +20% | 80% | 90 |
| custom-generate-script | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| custom-generate-script | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| custom-generate-script | `gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| explain-cli-flag | `claude-haiku-4-5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| explain-cli-flag | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| explain-cli-flag | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| explain-cli-flag | `gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 90% | 100 |
| mounted-changelog-urls | `claude-haiku-4-5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| mounted-changelog-urls | `gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| nav-unknown-group | `claude-haiku-4-5` | 100% [72–100%] | 20% [6–51%] | +80% | 100% | 100 |
| nav-unknown-group | `claude-opus-4-7` | 100% [72–100%] | 70% [40–89%] | +30% | 100% | 100 |
| nav-unknown-group | `claude-sonnet-4-6` | 100% [72–100%] | 10% [2–40%] | +90% | 100% | 100 |
| nav-unknown-group | `gpt-5.5` | 90% [60–98%] | 100% [72–100%] | -10% | 100% | 90 |
| search-when-embeddings | `claude-haiku-4-5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| search-when-embeddings | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| search-when-embeddings | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |
| search-when-embeddings | `gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 100 |

_Judge note: no candidate model graded its own output (no self-preference bias)._
