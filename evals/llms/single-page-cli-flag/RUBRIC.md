# Rubric: what `leadtype generate --json` reports

Task: explain what `leadtype generate --json` reports (answer in `ANSWER.md`).

Ground truth: `--json` (alias for `--format json`) prints a **single result object on stdout** describing what was generated — the mode, source/output dirs, product, groups, and a **`files` map of output paths**. In site mode that map includes `llmsTxt`, `docsLlmsTxt`, `llmsFullTxt`, `searchIndex`, `searchContent`, sitemap/robots, and `agentReadabilityManifest`. In `--bundle` mode `mode` is `"bundle"` and `files` contains only `agentsMd`.

## REQUIRED — all must be satisfied
- States it prints a **single JSON result object** (to stdout) describing the generation run.
- Names at least one of the generated output-path fields, e.g. **`llmsTxt`**, **`docsLlmsTxt`**, or **`llmsFullTxt`** (the answer-pattern keys).

## Bonus — strengthens but not required
- Notes additional fields (search index, sitemap, robots, manifest) and/or the `--bundle` shape (`agentsMd` only).

## Incorrect if
- Describes human-readable/log output instead of a structured JSON object.
- Invents fields that aren't part of the result shape.
