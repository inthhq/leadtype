# leadtype agent evals

Measure whether real coding agents discover and use leadtype's bundled docs (`AGENTS.md` + `docs/*.md`) when they're working in a project that depends on the package. Built on [`@vercel/agent-eval`](https://github.com/vercel-labs/agent-eval).

## What this answers

- **Discovery rate** — does the agent open `node_modules/leadtype/AGENTS.md` before guessing?
- **Pass rate** — can it complete leadtype-related tasks correctly?
- **Control delta** — pass rate WITH bundled docs minus pass rate WITHOUT. The bundled docs' value, in numbers.
- **Per-topic hit rate** — which `.md` files actually get read.

## Setup

```bash
cd evals
cp .env.example .env
# fill in AI_GATEWAY_API_KEY and VERCEL_TOKEN
bun install

# Pack leadtype as a tarball that fixtures can install in-sandbox.
bun run pack-leadtype
```

## Run

```bash
bun run evals:dry            # preview what would run
bun run evals                # run all experiments
bun run evals -- --filter bundled-docs   # one experiment
```

## Layout

```
evals/
├── experiments/
│   ├── bundled-docs.ts          # Treatment: leadtype installed normally
│   └── bundled-docs-control.ts  # Control: AGENTS.md + docs/ deleted
└── evals/
    ├── wire-content-negotiation/   # Add Accept: text/markdown to a vite app
    ├── validate-in-ci/             # Add a leadtype lint GH Actions workflow
    ├── explain-cli-flag/           # Q&A about --enrich-git
    └── bundle-own-docs/            # Configure --bundle in another package
```

Each fixture has `PROMPT.md` (the task), `EVAL.ts` (vitest assertions over the agent's transcript), and `package.json` (sandbox starter project).

## Interpreting results

After a run, `__agent_eval__/results.json` inside each sandbox holds the transcript. The `o11y` field has `filesRead`, `filesModified`, `shellCommands`, `toolCalls`, `webFetches`, etc. The `EVAL.ts` files assert against these.

Compare bundled-docs vs bundled-docs-control to see the lift from shipping `AGENTS.md`. If the delta is small for a fixture, that fixture's docs page may not be earning its place — or the agent finds it via training data without needing the bundle.
