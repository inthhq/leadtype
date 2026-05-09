# leadtype agent evals

Measure whether real coding agents (Claude, GPT) discover and use leadtype's bundled docs (`AGENTS.md` + `docs/*.md`) when they're working in a project that depends on the package. Custom harness on the Vercel AI SDK — no Docker, no Vercel platform dependency.

## What this answers

- **Discovery rate** — does the agent open `node_modules/leadtype/AGENTS.md` before guessing?
- **Pass rate** — can it complete leadtype-related tasks correctly?
- **Treatment vs control delta** — pass rate WITH bundled docs minus WITHOUT. The bundled docs' value, in numbers.
- **Per-topic hit rate** — which `.md` files actually get read.

## How it works

For each fixture × mode (treatment | control), the harness:

1. Creates a tempdir, copies the fixture's starter files in.
2. Runs `npm install <leadtype-tarball>` so `node_modules/leadtype/` looks like a real install.
3. In **control** mode, deletes `AGENTS.md` and `docs/` from the installed package — the agent has to fall back to its training data.
4. Runs `generateText` from the AI SDK with a small set of path-scoped tools: `read`, `write`, `list`, `glob`, `grep`, plus a narrow `npm` tool (allowlist: `pack`, `install` only).
5. Records every tool call into a transcript JSON.
6. Spawns vitest against the fixture's `EVAL.ts`, which asserts on the transcript (e.g., "did the agent read `node_modules/leadtype/AGENTS.md`?").

No shell, no Docker, no escape vector — every tool call resolves paths relative to the tempdir at the JS level (`resolveScoped` in `lib/tools.ts`). The agent literally cannot see anything outside the tempdir.

## Setup

```bash
cd evals
cp .env.example .env
# Fill in AI_GATEWAY_API_KEY. Models route through Vercel AI Gateway —
# one key handles Anthropic, OpenAI, Google, etc.
bun install

# Pack leadtype as a tarball that the harness installs into each sandbox.
bun run pack-leadtype
```

## Run

```bash
# Smoke test — one fixture, treatment mode, 1 run, default model.
bun run evals -- --fixture wire-content-negotiation --mode treatment

# Full matrix on the default model (claude-haiku-4-5).
bun run evals

# Flagship Anthropic model.
bun run evals -- --model claude-opus-4-7

# Flagship OpenAI model (needs OPENAI_API_KEY).
bun run evals -- --model gpt-5.5

# Stack repetitions.
bun run evals -- --runs 3
```

## CLI flags

| Flag | Default | Description |
| --- | --- | --- |
| `--fixture <name>` | (all) | Run only one fixture from `evals/<name>/`. |
| `--mode <m>` | both | `treatment` or `control`. |
| `--model <id>` | `claude-haiku-4-5` | Any `@ai-sdk/anthropic` or `@ai-sdk/openai` model id. Strings starting with `gpt-` route to OpenAI; everything else to Anthropic. |
| `--runs <n>` | `1` | Repetitions per (fixture × mode). |

## Layout

```
evals/
├── lib/
│   ├── tools.ts        # 6 path-scoped AI SDK tools (read/write/list/glob/grep/npm)
│   ├── tools.test.ts   # path-escape unit tests
│   ├── sandbox.ts      # tempdir lifecycle, npm install, control-mode strip
│   └── transcript.ts   # transcript types + writer/reader
├── evals/              # fixtures
│   ├── wire-content-negotiation/  (PROMPT.md, EVAL.ts, vite.config.ts, package.json)
│   ├── validate-in-ci/            (PROMPT.md, EVAL.ts, package.json)
│   ├── explain-cli-flag/          (PROMPT.md, EVAL.ts, package.json)
│   └── bundle-own-docs/           (PROMPT.md, EVAL.ts, package.json)
└── run-eval.ts         # entry — discovers fixtures, dispatches runs, prints summary
```

Each fixture's `PROMPT.md` is the task description. `EVAL.ts` reads the transcript via `readTranscript()` and asserts on `transcript.toolCalls` (e.g. did `read` tool open AGENTS.md?) plus the final state of files the agent wrote.

## Interpreting results

The summary table:

```
fixture                          treatment   control   delta   discovered AGENTS.md (treatment)
wire-content-negotiation         3/3         0/3       +100%   3/3
validate-in-ci                   3/3         2/3       +33%    3/3
explain-cli-flag                 3/3         0/3       +100%   3/3
bundle-own-docs                  2/3         0/3       +67%    3/3
```

A small delta on a fixture means the bundled docs aren't pulling their weight there — either the task is solvable from training data, or our docs page on that topic isn't earning agent visits. A 0/N treatment column means the AGENTS.md flow itself is broken (or the assertion is too strict).

## Tests

```bash
bun test lib   # unit tests for resolveScoped + read/write tools
```
