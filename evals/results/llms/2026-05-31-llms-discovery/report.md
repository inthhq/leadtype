# Hosted-docs benchmark — which llms.txt shape routes agents best

- **Run:** `2026-05-31-llms-discovery`
- **Generated:** 2026-06-01T09:16:15.318Z
- **Judge:** `deepseek/deepseek-v4-pro`
- **Candidate models:** `anthropic/claude-haiku-4.5`, `anthropic/claude-opus-4.8`, `openai/gpt-5.5`
- **Runs per cell:** 10
- **Total agent runs:** 180

Pass = the judge marked the answer correct against the rubric. **Context match** = the agent actually read the context path the variant intends (not just answered from `llms.txt` summaries or priors). A variant only earns trust when both are high.

### `anthropic/claude-haiku-4.5`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| discovery | 70% [57–80%] (42/60) | 7% | 0.00 | 4.1k | 8.3 | 24.4s |

### `anthropic/claude-opus-4.8`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| discovery | 87% [76–93%] (52/60) | 38% | 0.00 | 4.6k | 7.0 | 30.6s |

### `openai/gpt-5.5`

| Variant | Pass rate | Context match | Avg wrong-group reads | Tokens | Tool calls | Time |
| --- | --- | --- | --- | --- | --- | --- |
| discovery | 80% [68–88%] (48/60) | 43% | 0.00 | 3.2k | 7.8 | 22.1s |

_Judge note: no candidate model graded its own output (no self-preference bias)._
