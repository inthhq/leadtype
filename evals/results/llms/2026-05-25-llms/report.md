# Hosted-docs benchmark — which llms.txt shape routes agents best

- **Run:** `2026-05-25-llms`
- **Generated:** 2026-05-25T19:40:33.706Z
- **Judge:** `claude-opus-4-7`
- **Candidate models:** `claude-haiku-4-5`, `claude-opus-4-7`, `claude-sonnet-4-6`, `gpt-5.5`
- **Runs per cell:** 10
- **Total agent runs:** 1200

Pass = the judge marked the answer correct against the rubric. **Context match** = the agent actually read the context path the variant intends (not just answered from `llms.txt` summaries or priors). A variant only earns trust when both are high.

### `claude-haiku-4-5`

| Variant | Pass rate | Context match | Avg wrong-group reads |
| --- | --- | --- | --- |
| explicit-bundles | 97% [89–99%] (58/60) | 28% | 0.77 |
| monolith | 95% [86–98%] (57/60) | 77% | 0.00 |
| page-links | 100% [94–100%] (60/60) | 100% | 0.00 |
| router | 98% [91–100%] (59/60) | 40% | 0.65 |
| section-indexes | 98% [91–100%] (59/60) | 75% | 0.00 |

### `claude-opus-4-7`

| Variant | Pass rate | Context match | Avg wrong-group reads |
| --- | --- | --- | --- |
| explicit-bundles | 98% [91–100%] (59/60) | 35% | 0.62 |
| monolith | 100% [94–100%] (60/60) | 77% | 0.00 |
| page-links | 100% [94–100%] (60/60) | 82% | 0.00 |
| router | 100% [94–100%] (60/60) | 35% | 0.65 |
| section-indexes | 100% [94–100%] (60/60) | 80% | 0.00 |

### `claude-sonnet-4-6`

| Variant | Pass rate | Context match | Avg wrong-group reads |
| --- | --- | --- | --- |
| explicit-bundles | 100% [94–100%] (60/60) | 8% | 1.77 |
| monolith | 100% [94–100%] (60/60) | 100% | 0.00 |
| page-links | 100% [94–100%] (60/60) | 100% | 0.00 |
| router | 100% [94–100%] (60/60) | 7% | 1.37 |
| section-indexes | 100% [94–100%] (60/60) | 88% | 0.12 |

### `gpt-5.5`

| Variant | Pass rate | Context match | Avg wrong-group reads |
| --- | --- | --- | --- |
| explicit-bundles | 100% [94–100%] (60/60) | 23% | 0.90 |
| monolith | 100% [94–100%] (60/60) | 98% | 0.00 |
| page-links | 100% [94–100%] (60/60) | 100% | 0.00 |
| router | 100% [94–100%] (60/60) | 23% | 0.92 |
| section-indexes | 100% [94–100%] (60/60) | 88% | 0.00 |

_Judge note: `claude-opus-4-7` also served as (or matches) a judge model, so those rows are partly self-graded — read their deltas with that caveat._
