# Rubric: why AGENTS.md (not llms.txt) inside a tarball

Task: explain why `AGENTS.md`, not `llms.txt`, is the right shape for docs shipped inside an npm package, and which website artifacts `--bundle` skips.

Ground truth: `llms.txt` is a **website/HTTP convention** — a file at `/llms.txt` whose links are **absolute URLs** an agent fetches over the network. Inside a tarball that's the wrong shape: the links point at a hosted site the agent may not reach, and no major coding agent looks for `node_modules/<pkg>/llms.txt`. `AGENTS.md` is the **filesystem convention** (agents.md): it sits at the package root with **relative** `./docs/<topic>.md` links, so it works offline inside `node_modules/<pkg>/` and is version-matched to the installed code. `leadtype generate --bundle` therefore **skips the website-only / URL-anchored artifacts**: `llms.txt`, `llms-full.txt`, the search index, sitemap, robots, and agent-readability files.

## REQUIRED — all must be satisfied
- Explains `llms.txt` is a website/HTTP convention with **absolute URLs** (and/or that nothing looks for it in `node_modules`) — so it's wrong inside a tarball.
- Explains `AGENTS.md` works inside the installed package because its links are **relative** / it needs no network (offline, version-matched).
- States `--bundle` **skips** website artifacts — at minimum `llms.txt` and `llms-full.txt` (search/sitemap/robots strengthen the answer).

## Incorrect if
- Recommends shipping `llms.txt` in the tarball, or treats the two as interchangeable.
- Claims `AGENTS.md` uses absolute URLs, or that `--bundle` emits `llms.txt`/`llms-full.txt`.
