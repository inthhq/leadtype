# Rubric: agent-facing output APIs vs search UI

Task: the user wants the agent-facing output APIs, **not** the search UI. Identify which docs area to use, and when to use the monolithic `/llms-full.txt` fallback.

Ground truth: the agent-facing output APIs live in the **LLM files** reference (the `leadtype/llm` entry point) — `generateLlmsTxt`, **`generateLLMFullContextFiles`**, `generateAgentReadabilityArtifacts`, `generateAgentsMd` — not the Search docs. The monolithic root **`/llms-full.txt`** (produced by `generateLLMFullContextFiles`) is the **broad all-docs fallback**, used when page-level `llms.txt` markdown links are **not enough** for the task.

## REQUIRED — all must be satisfied
- Points to the **LLM files / `leadtype/llm`** output APIs (e.g. names `generateLLMFullContextFiles` or the "LLM files" area) as the right place — and does **not** route the user to the Search UI/APIs.
- Explains the monolithic **`/llms-full.txt`** is the broad fallback, used **when page-level links are insufficient**.

## Incorrect if
- Recommends the Search docs / search streaming APIs as the answer.
- Describes `/llms-full.txt` as the default/primary path rather than a fallback.
