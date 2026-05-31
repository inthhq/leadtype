# leadtype agent evals

Measure whether real coding agents (Claude, GPT) discover and use leadtype's bundled docs (`AGENTS.md` + `docs/*.md`) when they're working in a project that depends on the package. Custom harness on the Vercel AI SDK — no Docker, no Vercel platform dependency.

## What this answers

- **Pass rate** — can the agent complete leadtype-related tasks correctly? Correctness is graded by an **independent LLM judge** against a per-fixture `RUBRIC.md`, not by keyword matching. This is the headline metric.
- **Treatment vs control delta** — judged pass rate WITH bundled docs minus WITHOUT. The bundled docs' value, in points, reported with a **Wilson 95% confidence interval** so small-sample noise is visible.
- **Bundle usage (mechanism)** — did the agent actually read the bundle (`AGENTS.md` or any `docs/*.md`) in treatment? A supporting metric, not the pass gate. Only *successful* reads count: in control the bundle is deleted, so an attempted read fails (ENOENT) and is not mistaken for usage.
- **Efficiency (cost)** — average total tokens, tool calls, and wall-clock per run, reported per arm with a treatment-vs-control delta. Answers "does bundling docs make a run cheaper or more expensive?" — a short doc can replace a flurry of exploratory `grep`/`read` calls, or add an upfront read.

> Headline correctness is the judge's verdict. The "did it read our files" checks are reported as supporting evidence, never as the pass condition — so treatment and control are graded on the same footing (in control the bundle is gone, so a read-gate would be meaningless).

## How it works

For each fixture × mode (treatment | control) × model × run, the harness:

1. Creates a tempdir, copies the fixture's starter files in (`PROMPT.md`, `EVAL.ts`, and `RUBRIC.md` are held back — they belong to the harness, and leaking `RUBRIC.md` would hand the agent the answer key).
2. Runs `npm install <leadtype-tarball>` so `node_modules/leadtype/` looks like a real install.
3. In **control** mode, deletes `AGENTS.md` and `docs/` from the installed package — the agent has to fall back to its training data (the compiled `dist/` still ships, exactly as a real published package would).
4. Runs `generateText` from the AI SDK with a small set of path-scoped tools: `read`, `write`, `list`, `glob`, `grep`, plus a narrow `npm` tool (allowlist: `pack`, `install` only). Tool output is size-capped so one minified bundle can't blow the context window.
5. Records every tool call into a transcript, then sends the agent's answer (and any files it produced) to the **LLM judge**, which grades it against the fixture's `RUBRIC.md` and returns `{ correct, score, reasoning }`.
6. Writes `transcript.json`, `judge.json`, and a flat `record.json` per run under `results/`, then aggregates all records into `summary.json` + `report.md` (pass rates, Wilson CIs, treatment/control deltas).

No shell, no Docker, no escape vector — every tool call resolves paths relative to the tempdir at the JS level (`resolveScoped` in `lib/tools.ts`). The agent literally cannot see anything outside the tempdir.

### The judge

`lib/judge.ts` calls a strong model (default `deepseek/deepseek-v4-pro`, set with `--judge`) at temperature 0. It's chosen to be **neutral to every candidate family** — the candidate set spans Anthropic, OpenAI, Google, and Moonshot, so the judge comes from a family with no candidate (DeepSeek). Cross-validate the headline with a second neutral judge (`rejudge --judge xai/grok-4.3`). It sees the task, the rubric (ground truth), and the agent's output, and marks `correct` only when every REQUIRED rubric point is met. It also classifies a **failure mode** (`none` / `confident_wrong` / `uncertain` / `refused`); the package report surfaces the **confident-wrong rate** per arm, so you can see whether docs cut the dangerous "states the opposite of the truth" answers, not just raise the pass rate. A judge call that fails fails *closed* — counted as a miss, never crashing the matrix. Pick a judge outside your candidate set to avoid self-preference bias; the report flags any candidate that also served as judge.

### Arms: discovery vs. the recommended setup

The default package run tests **organic discovery** — the bundle is installed but nothing tells the agent it exists, so `treatment` only pays off if the agent explores `node_modules` and finds `AGENTS.md`/`docs/` on its own. Two optional arms separate *discovery* from *value*:

- **`pointer`** (package, `--mode pointer`) — `treatment` plus leadtype's *recommended* root `AGENTS.md` pointer. Measures the documented happy path; compare against plain `treatment` to see how much the pointer adds. The report adds a "Recommended setup" section when this arm runs.
- **`--discovery`** (llms) — drops the "start at /llms.txt" hint and serves a realistic web root (docs pages + `llms.txt` + `llms-full.txt` + `robots.txt` + `sitemap.xml`). The "context match" column then reads as *did the agent consult `/llms.txt` unprompted* — i.e. whether the convention gets used in the wild, not just whether a known entry point routes well.

Convenience matrices: `bun run evals:full:arms` (treatment+control+pointer) and `bun run evals:llms:discovery`.

## Setup

```bash
# From the repo root: put AI_GATEWAY_API_KEY in the repo-root .env.
# One Vercel AI Gateway key brokers Anthropic, OpenAI, and Google.
# The eval scripts load it with `bun --env-file=../.env`.
echo "AI_GATEWAY_API_KEY=..." >> .env

cd evals
bun install

# Build leadtype and pack it as a tarball the harness installs into each
# sandbox. `pack-leadtype` runs the build first, so AGENTS.md + docs/ are
# actually in the tarball (without the build the package ships empty).
bun run pack-leadtype
```

## Run

```bash
# Smoke test — one fixture, treatment mode, 1 run, default model.
bun run evals -- --fixture nav-unknown-group --mode treatment

# Default model (claude-haiku-4-5), all fixtures, both modes, 1 run each.
bun run evals

# The full matrix: 6 models across 4 families × 10 runs, judged by the neutral
# deepseek-v4-pro. (= claude haiku-4.5/sonnet-4.6/opus-4.8, gpt-5.5,
# kimi-k2.6, gemini-3.5-flash)
bun run evals:full -- --label 2026-05-31

# Pick your own grid (use full provider/model ids for non-Anthropic models).
bun run evals -- --models anthropic/claude-opus-4.8,moonshotai/kimi-k2.6 --runs 5 --judge deepseek/deepseek-v4-pro
```

Every run writes to `results/package/<label>/` (label defaults to a timestamp). Re-aggregate an existing run folder without re-running the models:

```bash
bun run aggregate results/package/2026-05-25-package
```

If you change how a *mechanism* metric is derived (bundle usage, context match), recompute it for an already-graded run straight from its archived transcripts — no agents, no judge re-run. It rewrites each `record.json`'s supporting metrics in place (the judge verdict is preserved) and re-aggregates:

```bash
bun run remetric results/package/2026-05-25-package
```

`results/` is gitignored by default (the harness writes a folder per local run), so publish a run explicitly with `git add -f results/<benchmark>/<label>`. `summary.json`, `report.md`, and per-run `record.json` are committed loose. `record.json` holds the **canonical verdict** (the `2026-05-25` run is graded by `gemini-3-pro`); the `judge.json` inside `transcripts.tgz` is the original first-pass (Opus) verdict, kept as a historical cross-judge artifact. The bulky per-run `transcript.json` + `judge.json` + produced `files/` are bundled into `transcripts.tgz` to keep the repo light — regenerate the loose copies with `tar xzf transcripts.tgz`. To re-bundle after a fresh run:

```bash
cd results/<benchmark>/<label>
find runs \( -name transcript.json -o -name judge.json -o -name ANSWER.md \) -print > /tmp/arc
find runs -type d -name files -print >> /tmp/arc
tar czf transcripts.tgz -T /tmp/arc && tar tzf transcripts.tgz >/dev/null \
  && { find runs \( -name transcript.json -o -name judge.json -o -name ANSWER.md \) -delete; \
       find runs -type d -name files -exec rm -rf {} +; }
```

## Topic-scoped `llms-full` benchmark

Issue #22 asks whether agents actually use topic-scoped full-context bundles when `llms.txt` makes them discoverable. The separate llms benchmark simulates a hosted docs web root as local files: `/llms.txt` maps to `llms.txt`, `/docs/reference/cli.md` maps to `docs/reference/cli.md`, and so on.

```bash
# One fixture across all variants.
bun run evals:llms -- --fixture single-page-cli-flag

# One fixture on the router-first variant.
bun run evals:llms -- --fixture exact-symbol-readability --variant router

# Default model, all fixtures × all variants, 1 run each.
bun run evals:llms

# The published matrix: 4 models × 10 runs.
bun run evals:llms:full -- --label 2026-05-25
```

Here a "pass" still means the judge marked the answer correct, but the report also tracks **context match** — whether the agent read the context path the variant intends, rather than answering from `/llms.txt` summaries or prior knowledge. A variant only earns trust when both pass rate and context match are high.

The variants are:

| Variant | Meaning |
| --- | --- |
| `page-links` | Current-style `/llms.txt` with page-level `.md` links and guidance text only. |
| `explicit-bundles` | `/llms.txt` links each `/docs/llms-full/<group>.txt` topic bundle directly. |
| `monolith` | `/llms.txt` links one root `/llms-full.txt` containing all docs content. |
| `router` | `/llms.txt` links root `/llms-full.txt`, and that file routes to `/docs/llms-full/<group>.txt`. |
| `section-indexes` | `/llms.txt` links `/docs/<group>/llms.txt`; each section index links page `.md` files plus an optional section full-context bundle. |

The `router` variant is intentionally distinct from `monolith`: it evaluates a base file that directs agents to topic bundles, not a root file containing all docs content.

## Performance & tuning

The matrix is **network-bound** — wall-clock is dominated by model latency, not CPU. Levers:

- **`--concurrency <n>`** is the main knob (full scripts default to 20). Each in-flight run holds one slot through both its agent call and its judge call, so `n` ≈ simultaneous gateway requests. Raise it for faster local runs; if you start seeing repeated retries or rate-limit errors in the output, the gateway is throttling you — drop back to ~8–12.
- **Sandbox setup is already cheap.** The `node_modules/leadtype` template is installed **once** and copy-on-write cloned per sandbox (APFS `clonefile` on macOS, near-instant); it's pre-warmed before the pool so the first batch doesn't stall. The `bare` arm skips the install entirely.
- **Judging is inline** (each run grades itself), so agent and judge calls hit different providers and don't contend for the same rate limit. If you ever need to max throughput further, the next step would be a two-pass design (run all agents, then judge from saved transcripts) — not currently needed.

A 4-model × 10-run full matrix is ~hundreds–thousands of runs; at `--concurrency 20` expect roughly 1–2.5h depending on arms and gateway limits.

## CLI flags

| Flag | Default | Description |
| --- | --- | --- |
| `--fixture <name>` | (all) | Run only one fixture. |
| `--mode <a,b>` | `treatment,control` | Comma list of arms: `bare`, `control`, `treatment`, `pointer`. Package benchmark only. |
| `--variant <name>` | all | One llms.txt shape. llms benchmark only. |
| `--discovery` | off | Unhinted discovery arm — realistic web root, no "start at llms.txt" hint. llms benchmark only. |
| `--models <a,b,c>` | `claude-haiku-4-5` | Comma-separated candidate model ids. An id with a `provider/` prefix (e.g. `moonshotai/kimi-k2.6`) passes through as-is; a bare id routes by family (`gpt-*`→OpenAI, `gemini*`→Google, else Anthropic). |
| `--model <id>` | — | Alias for a single `--models` entry. |
| `--judge <id>` | `deepseek/deepseek-v4-pro` | Model that grades answers against each `RUBRIC.md`. Keep it outside every candidate family. |
| `--runs <n>` | `1` | Repetitions per cell (fixture × mode/variant × model). |
| `--label <name>` | timestamp | Results folder name under `results/<benchmark>/`. |

## Layout

```
evals/
├── lib/
│   ├── tools.ts             # path-scoped AI SDK tools (read/write/list/glob/grep/npm), output-capped
│   ├── sandbox.ts           # package-eval tempdir lifecycle, npm install, control strip
│   ├── llms-sandbox.ts      # llms-eval tempdir lifecycle, web-root materialization
│   ├── llms-variants.ts     # five llms.txt/llms-full.txt artifact shapes under test
│   ├── llms-metrics.ts      # transcript → selection/context-match decisions
│   ├── package-metrics.ts   # transcript → bundle-usage decisions (successful reads only)
│   ├── reads.ts             # shared readSucceeded predicate (ignores failed/ENOENT reads)
│   ├── judge.ts             # LLM judge: grade an answer against a RUBRIC.md
│   ├── stats.ts             # Wilson confidence intervals + aggregation
│   ├── record.ts            # per-run record schema (one row of evidence)
│   ├── aggregate.ts         # records → summary.json + report.md (also a CLI)
│   ├── models.ts            # model-id namespacing + --models parsing
│   ├── transcript.ts        # transcript types + writer/reader
│   └── *.test.ts            # unit tests for tools + metrics
├── rejudge.ts               # re-grade saved answers with a different judge (no agents re-run)
├── remetric.ts              # recompute mechanism metrics from saved transcripts (no agents/judge re-run)
├── evals/                   # package-docs benchmark fixtures
│   └── <fixture>/           (PROMPT.md, RUBRIC.md, package.json, …)
├── llms/                    # hosted-docs (llms.txt) benchmark fixtures
│   └── <fixture>/           (PROMPT.md, RUBRIC.md, expected.json)
├── results/                 # committed run output: <benchmark>/<label>/
│   └── <label>/
│       ├── summary.json     # per-cell aggregates + CIs + deltas
│       ├── report.md        # human-readable tables
│       ├── transcripts.tgz  # full transcript.json + judge.json + produced files/ per run
│       └── runs/<fixture>/<arm>/<model>/run-<i>/record.json  # flat per-run evidence (kept loose)
├── run-eval.ts              # entry — package-docs benchmark
└── run-llms-eval.ts         # entry — hosted-docs (llms.txt) benchmark
```

Each fixture's `PROMPT.md` is the task; `RUBRIC.md` is the ground-truth grading criteria the judge uses (never copied into the sandbox). `expected.json` (llms only) defines the intended context path for the context-match metric.

## Interpreting results

Open `results/<benchmark>/<label>/report.md`. The package report leads with per-model treatment vs control:

| Model | Treatment | Control | Delta |
| --- | --- | --- | --- |
| `claude-opus-4-8` | 88% [74–95%] (35/40) | 45% [31–60%] (18/40) | +43% |

Brackets are the Wilson 95% interval; `(passes/n)` is the raw count. A **large positive delta** is the bundled docs earning their place. A **small delta** means the task is recoverable without docs — often because the compiled CLI self-documents the flag, or the model already knew it. A **wide interval** means you need more `--runs`. The per-fixture table adds bundle-usage (did the agent read the bundle in treatment) and the judge's mean score.

The report also has an **Efficiency** section: per model, average tokens / tool calls / wall-clock for treatment vs control, with a signed delta. A negative delta means bundling docs made runs *cheaper* — the agent reads one short doc instead of probing the package with repeated `grep`/`read`/`list` calls. This is orthogonal to correctness: docs can leave the pass rate flat yet still cut tokens and time.

## Tests

```bash
bun test lib   # unit tests for resolveScoped, tool output caps, and llms metrics
```
