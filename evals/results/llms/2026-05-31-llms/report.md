# Hosted-docs benchmark — which llms.txt shape routes agents best

- **Run:** `2026-05-31-llms`
- **Generated:** 2026-06-01T09:07:07.507Z
- **Judge:** `deepseek/deepseek-v4-pro`
- **Candidate models:** `anthropic/claude-haiku-4.5`, `anthropic/claude-opus-4.8`, `openai/gpt-5.5`
- **Runs per cell:** 10
- **Total agent runs:** 900

Pass = the judge marked the answer correct against the rubric. **Context match** = the agent actually read the context path the variant intends (not just answered from `llms.txt` summaries or priors). A variant only earns trust when both are high.

### `anthropic/claude-haiku-4.5`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| explicit-bundles | 78% [66–87%] (47/60) | 40% | 0.62 | 4.0k | 6.0 | 16.2s |
| monolith | 85% [74–92%] (51/60) | 80% | 0.00 | 4.2k | 5.9 | 14.9s |
| page-links | 75% [63–84%] (45/60) | 100% | 0.00 | 3.2k | 4.5 | 13.0s |
| router | 83% [72–91%] (50/60) | 42% | 0.63 | 3.9k | 6.6 | 15.8s |
| section-indexes | 78% [66–87%] (47/60) | 77% | 0.02 | 3.8k | 7.3 | 16.8s |

### `anthropic/claude-opus-4.8`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| explicit-bundles | 83% [72–91%] (50/60) | 17% | 1.08 | 4.9k | 5.4 | 24.7s |
| monolith | 87% [76–93%] (52/60) | 70% | 0.00 | 5.1k | 4.7 | 23.4s |
| page-links | 85% [74–92%] (51/60) | 100% | 0.00 | 4.2k | 4.8 | 23.2s |
| router | 85% [74–92%] (51/60) | 20% | 0.98 | 4.8k | 5.7 | 25.5s |
| section-indexes | 82% [70–89%] (49/60) | 100% | 0.00 | 4.7k | 6.9 | 27.5s |

### `openai/gpt-5.5`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| explicit-bundles | 83% [72–91%] (50/60) | 22% | 1.08 | 2.7k | 6.1 | 18.2s |
| monolith | 83% [72–91%] (50/60) | 98% | 0.00 | 2.5k | 3.6 | 14.5s |
| page-links | 85% [74–92%] (51/60) | 100% | 0.00 | 2.1k | 5.6 | 18.4s |
| router | 82% [70–89%] (49/60) | 23% | 0.85 | 2.7k | 6.8 | 20.0s |
| section-indexes | 87% [76–93%] (52/60) | 87% | 0.00 | 3.0k | 7.8 | 23.5s |

_Judge note: no candidate model graded its own output (no self-preference bias)._
