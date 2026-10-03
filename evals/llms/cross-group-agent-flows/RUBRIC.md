# Rubric: hosted website flow vs npm bundle flow

Task: compare the hosted website flow and the npm package bundle flow for agents — which files each flow starts from, and which website artifacts bundle mode skips.

Ground truth:
- **Hosted website flow:** the agent starts at **`/llms.txt`** over HTTP, follows page-level `.md` links first, and falls back to the root **`/llms-full.txt`** when page links aren't enough.
- **npm bundle flow:** the agent reads **`AGENTS.md`** from `node_modules/<pkg>/AGENTS.md`, then follows relative `./docs/<topic>.md` links offline.
- **Bundle mode (`--bundle`) skips** the website-only artifacts: `llms.txt`, `llms-full.txt`, the search index, sitemap, robots, and agent-readability files.

## REQUIRED — all must be satisfied
- Hosted flow **starts from `llms.txt`** (HTTP).
- Bundle flow **starts from `AGENTS.md`** (in the installed package).
- States that `--bundle` mode **skips** website artifacts — at minimum `llms.txt` and `llms-full.txt` (search/sitemap/robots strengthen the answer).

## Incorrect if
- Swaps the entry points (says hosted starts at AGENTS.md, etc.).
- Claims bundle mode emits `llms.txt`/`llms-full.txt`.
