# Rubric: the agent-readability artifact-path guard

Task: identify the helper that prevents agent-readability artifacts like `llms.txt` and `llms-full.txt` from being rewritten as missing markdown pages, and briefly describe what it covers.

Ground truth: the helper is **`isAgentReadabilityArtifactPath`** (from `leadtype/llm/readability`). It returns true for the discovery/artifact paths that the markdown content-negotiation layer must leave alone instead of rewriting into a markdown mirror or a "page not found" markdown body: **`llms.txt`, `llms-full.txt`, sitemap (`sitemap.xml`/`sitemap.md`), `robots.txt`, the search JSON files, and the `agent-readability.json` manifest**.

## REQUIRED — all must be satisfied
- Names the helper exactly: **`isAgentReadabilityArtifactPath`**.
- Describes that it covers / matches the artifact paths to skip — at minimum **`llms.txt`** and **`llms-full.txt`**, and ideally sitemap, robots, search JSON, and the manifest.

## Incorrect if
- Names a different/invented function.
- Describes it as doing something other than guarding these artifact paths from rewrite.
