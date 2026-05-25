# Package-docs benchmark — bundled docs vs no bundle

- **Run:** `2026-05-25-package`
- **Generated:** 2026-05-25T17:50:23.292Z
- **Judge:** `claude-opus-4-7`
- **Candidate models:** `claude-haiku-4-5`, `claude-opus-4-7`, `claude-sonnet-4-6`, `gpt-5.5`
- **Runs per cell:** 10
- **Total agent runs:** 480

## Headline: does bundling docs lift task success?

Pass = an independent LLM judge marked the agent's answer correct against the fixture rubric. **Treatment** = the leadtype package ships its bundled `AGENTS.md` + `docs/`. **Control** = those files are stripped from the installed package, so the agent must fall back to training data. Delta is the bundled docs' value, in points.

### Per model, pooled across fixtures

| Model | Treatment | Control | Delta |
| --- | --- | --- | --- |
| `claude-haiku-4-5` | 100% [94–100%] (60/60) | 75% [63–84%] (45/60) | +25% |
| `claude-opus-4-7` | 100% [94–100%] (60/60) | 95% [86–98%] (57/60) | +5% |
| `claude-sonnet-4-6` | 100% [94–100%] (60/60) | 85% [74–92%] (51/60) | +15% |
| `gpt-5.5` | 98% [91–100%] (59/60) | 88% [78–94%] (53/60) | +10% |

### Per fixture × model

| Fixture | Model | Treatment | Control | Delta | Used bundle (treatment) | Mean score |
| --- | --- | --- | --- | --- | --- | --- |
| bundle-rationale | `claude-haiku-4-5` | 100% [72–100%] | 80% [49–94%] | +20% | 100% | 91 |
| bundle-rationale | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 94 |
| bundle-rationale | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 91 |
| bundle-rationale | `gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 92 |
| custom-generate-script | `claude-haiku-4-5` | 100% [72–100%] | 70% [40–89%] | +30% | 80% | 91 |
| custom-generate-script | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 92 |
| custom-generate-script | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 94 |
| custom-generate-script | `gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 91 |
| explain-cli-flag | `claude-haiku-4-5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 96 |
| explain-cli-flag | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 95 |
| explain-cli-flag | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 96 |
| explain-cli-flag | `gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 90% | 94 |
| mounted-changelog-urls | `claude-haiku-4-5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 94 |
| mounted-changelog-urls | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 96 |
| mounted-changelog-urls | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 94 |
| mounted-changelog-urls | `gpt-5.5` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 94 |
| nav-unknown-group | `claude-haiku-4-5` | 100% [72–100%] | 20% [6–51%] | +80% | 100% | 92 |
| nav-unknown-group | `claude-opus-4-7` | 100% [72–100%] | 70% [40–89%] | +30% | 100% | 95 |
| nav-unknown-group | `claude-sonnet-4-6` | 100% [72–100%] | 10% [2–40%] | +90% | 100% | 94 |
| nav-unknown-group | `gpt-5.5` | 90% [60–98%] | 80% [49–94%] | +10% | 100% | 81 |
| search-when-embeddings | `claude-haiku-4-5` | 100% [72–100%] | 80% [49–94%] | +20% | 100% | 94 |
| search-when-embeddings | `claude-opus-4-7` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 96 |
| search-when-embeddings | `claude-sonnet-4-6` | 100% [72–100%] | 100% [72–100%] | +0% | 100% | 96 |
| search-when-embeddings | `gpt-5.5` | 100% [72–100%] | 50% [24–76%] | +50% | 100% | 95 |

_Judge note: `claude-opus-4-7` also served as (or matches) a judge model, so those rows are partly self-graded — read their deltas with that caveat._
