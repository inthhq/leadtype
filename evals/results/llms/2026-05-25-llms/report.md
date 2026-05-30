# Hosted-docs benchmark — which llms.txt shape routes agents best

- **Run:** `2026-05-25-llms`
- **Generated:** 2026-05-30T09:36:49.566Z
- **Judge:** `gemini-3-pro`
- **Candidate models:** `claude-haiku-4-5`, `claude-opus-4-7`, `claude-sonnet-4-6`, `gpt-5.5`
- **Runs per cell:** 10
- **Total agent runs:** 1200

Pass = the judge marked the answer correct against the rubric. **Context match** = the agent actually read the context path the variant intends (not just answered from `llms.txt` summaries or priors). A variant only earns trust when both are high.

### `claude-haiku-4-5`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| explicit-bundles | 98% [91–100%] (59/60) | 30% | 0.75 | 4.1k | 6.3 | 15.9s |
| monolith | 95% [86–98%] (57/60) | 77% | 0.00 | 4.1k | 5.2 | 14.1s |
| page-links | 97% [89–99%] (58/60) | 100% | 0.00 | 3.3k | 5.1 | 23.6s |
| router | 98% [91–100%] (59/60) | 40% | 0.63 | 3.9k | 6.2 | 15.7s |
| section-indexes | 97% [89–99%] (58/60) | 75% | 0.00 | 3.7k | 6.5 | 16.9s |

### `claude-opus-4-7`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| explicit-bundles | 98% [91–100%] (59/60) | 35% | 0.62 | 5.0k | 4.2 | 28.4s |
| monolith | 100% [94–100%] (60/60) | 77% | 0.00 | 5.4k | 4.4 | 27.7s |
| page-links | 100% [94–100%] (60/60) | 82% | 0.00 | 4.5k | 4.1 | 33.3s |
| router | 100% [94–100%] (60/60) | 35% | 0.65 | 5.2k | 5.2 | 31.9s |
| section-indexes | 98% [91–100%] (59/60) | 80% | 0.00 | 5.3k | 5.8 | 34.0s |

### `claude-sonnet-4-6`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| explicit-bundles | 98% [91–100%] (59/60) | 8% | 1.77 | 4.4k | 5.5 | 29.6s |
| monolith | 100% [94–100%] (60/60) | 100% | 0.00 | 4.6k | 4.7 | 30.8s |
| page-links | 98% [91–100%] (59/60) | 100% | 0.00 | 3.6k | 4.6 | 30.1s |
| router | 98% [91–100%] (59/60) | 7% | 1.37 | 4.3k | 6.1 | 31.5s |
| section-indexes | 100% [94–100%] (60/60) | 88% | 0.12 | 4.2k | 7.8 | 33.2s |

### `gpt-5.5`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| explicit-bundles | 100% [94–100%] (60/60) | 23% | 0.90 | 2.8k | 6.0 | 18.4s |
| monolith | 100% [94–100%] (60/60) | 98% | 0.00 | 2.6k | 4.2 | 16.8s |
| page-links | 100% [94–100%] (60/60) | 100% | 0.00 | 2.1k | 5.3 | 17.4s |
| router | 100% [94–100%] (60/60) | 23% | 0.92 | 2.8k | 6.5 | 20.8s |
| section-indexes | 100% [94–100%] (60/60) | 88% | 0.00 | 3.0k | 7.9 | 23.0s |

_Judge note: no candidate model graded its own output (no self-preference bias)._
