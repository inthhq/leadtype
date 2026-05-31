# Eval areas — what we measure, what we don't, what to build next

A living map of the questions these harnesses can answer about shipping
agent-readable docs. Use it to decide what to prioritize. Status legend:
**✅ covered** · **🟡 partial / just added (run it)** · **⬜ gap**.

The two existing harnesses: `run-eval.ts` (package bundle: `AGENTS.md` + `docs/`
in `node_modules`) and `run-llms-eval.ts` (hosted docs site behind `llms.txt`).

---

## 1. Does bundling docs help? (correctness lift) — ✅ covered

`treatment` (bundle present) vs `control` (bundle stripped, compiled
code+types+README+training only), judged by a neutral LLM judge on the answer.
This is the headline. Finding: large lift for small models, small for frontier,
concentrated on non-obvious behavior.

## 2. Run cost / efficiency — ✅ covered (Finding 4)

Tokens, tool calls, wall-clock per run, treatment vs control. Finding: docs cut
run cost 15–51% even when they don't move the pass rate (the agent reads one doc
instead of probing the package). **This is the "guess-from-code" baseline you
asked about — `control` *is* the LLM guessing from compiled code; the efficiency
delta is the token cost of that guessing.**

## 3. Discovery — does the agent even find the docs?

- **Package, organic** — ✅ covered. With *no* pointer, the bundle is read in
  95–100% of treatment runs (agents glob `node_modules/leadtype/docs` directly;
  `AGENTS.md` itself read ~63%). Mechanism metric, now counts only successful reads.
- **Package, recommended setup** — 🟡 just added (`--mode pointer`). Seeds the
  root `AGENTS.md` pointer leadtype tells consumers to add; isolates "discovery"
  from "value." Run `evals:full:arms`.
- **Hosted, unprompted** — 🟡 just added (`--discovery`). Drops the "start at
  /llms.txt" hint, serves a realistic web root (docs + llms.txt + llms-full +
  robots + sitemap); measures whether the `llms.txt` convention gets used in the
  wild. Run `evals:llms:discovery`. Fixtures that named the entry file get a
  neutral `DISCOVERY_PROMPT.md`. **Caveat:** `cross-group-agent-flows` asks which
  files each flow *starts from*, so its answer inherently requires reading
  `llms.txt`/`AGENTS.md` — its consult-rate will read ~100% regardless and is not
  a real discovery signal. Read the per-fixture breakdown, not just the average,
  or drop it from the discovery headline.

## 4. Routing — which `llms.txt` shape routes best? — ✅ covered

Five hosted shapes × context-match (judge-independent). Finding: page-links +
monolith route reliably; explicit group bundles + router get bypassed.

## 5. Baseline decomposition — code vs docs vs memory — ⬜ gap (one piece)

`control` keeps the *installed compiled package* (JS + `.d.ts` + README). That
conflates "the code/types helped" with "the model already knew." Add a third
baseline: **no package installed at all** (pure training recall, agent must
answer from memory). Decomposes the control number into "installed code is worth
X" vs "prior knowledge is worth Y." Cheap to add (a sandbox mode that skips the
install / strips the whole package). **High value, directly extends your
baseline question.**

## 6. Staleness / version-matching — ⬜ gap — **highest-value missing test**

The strongest argument for *bundling* (vs hoping the model knows): bundled docs
are **version-matched**, training data drifts. Build a fixture where the API
**changed** (a renamed flag, reordered args, changed default) between a plausible
training cutoff and the shipped version. Prediction: `control` answers from stale
memory and gets it *confidently wrong*; `treatment` reads the current bundle and
gets it right. This is the "docs prevent confident wrong answers" finding made
causal and unfakeable. ⬜ Not yet built.

## 7. Can docs *hurt*? (adversarial / liability) — ⬜ gap

- A **stale or wrong** bundled doc: does the agent trust it over correct code?
- **Conflicting** signals (doc says X, types say Y) — which wins?
  Important for "should we bundle docs" — the answer isn't free if bad docs
  mislead. ⬜ Not built.

## 8. Fixture difficulty & coverage — 🟡 partial — **high value**

Current 6 package fixtures are mostly recoverable without docs except the one
gotcha; we found **no docs-gap for GPT‑5.5** (FINDINGS caveat). To show docs help
even frontier models, add **more obscure / novel API surface** and more
behavioral gotchas. The benchmark's discriminating power is bounded by fixture
difficulty. 🟡 Have 6; need harder ones.

## 9. Corpus scale (hosted) — ⬜ gap

Hosted pass rate saturates because the corpus is tiny — the monolith's edge could
erode on a large docs set. Test with a much larger generated corpus to see where
page-links vs monolith diverge. ⬜ Not built.

## 10. Tool-use realism — ⬜ gap — **could change the headline**

Agents here have `read/write/list/glob/grep` (+ narrow `npm`), **no web fetch**.
A real coding agent with web access could fetch the *hosted* docs even in
`control` — eroding the bundle's value. Add a `fetch` tool arm to measure whether
the offline bundle still wins when the network is available. ⬜ Not built.

## 11. Bundle *format* — ⬜ gap

Does `AGENTS.md` structure / chunking / front-loading matter? Flattened markdown
vs other shapes. We test "docs vs none," not "which doc format." ⬜ Not built.

## 12. Realism: multi-dep projects & multi-turn — ⬜ gap

Fixtures are single-package toy projects with a direct question. Real sessions
have many deps (noise the bundle must be found amid) and multi-turn, messy tasks.
⬜ Not built.

## 13. Model & judge coverage — ✅ / 🟡

4 candidates; judge cross-validated across 3 models. Could add more candidates
(smaller/OSS models, Gemini as a candidate) and a human spot-check of judge
verdicts. Low urgency.

## 14. Failure-mode breakdown — 🟡 just added (lands in this run)

Pass/fail alone hides *how* an answer was wrong. The judge now classifies every
verdict as `none | confident_wrong | uncertain | refused`, and the report shows
the **confident-wrong rate** per arm. Turns Finding 3 ("docs prevent confidently
wrong answers") into a number — the most defensible reason to bundle. Lands
natively in the fresh run; `rejudge --in-place` can back-fill an existing run.

## 15. Flattened markdown vs raw MDX — ⬜ gap — **leadtype's core thesis**

Leadtype's whole pitch is flattening MDX so agents can read it. We test *docs vs
none*, never *flattened markdown vs the raw `.mdx` with unresolved components*. A
third bundle arm that ships raw MDX would directly answer "does flattening
actually help an agent." If it doesn't move the needle, that's a finding leadtype
needs. Reuses existing fixtures. ⬜ Not built — highest leadtype-specific value.

## 16. Grounding (read ≠ used) — ⬜ gap

`usedBundle`/`discoveredLlmsTxt` say the agent *read* a doc; they don't say the
answer *traces* to it. A grounding check (does the answer's claim appear in the
doc that was read, or was it confabulated afterward?) separates "opened the file"
from "actually used it." ⬜ Not built.

## 17. Over-trust / negative calibration — ⬜ gap (extends #7)

Ask about a feature that does **not** exist. Does bundling make the agent
over-confident ("yes, leadtype supports that") or does it correctly say "not
documented"? Bundling could *worsen* hallucination by lending false authority.
Needs new fixtures. ⬜ Not built.

## 18. Imperative instruction-following — ⬜ gap

`AGENTS.md` can carry *instructions* ("always use the source primitive, never
`fs.readdir`"), not just reference facts. Does the agent actually *obey* bundled
directives? A distinct capability from fact lookup, and how many `AGENTS.md`
files are actually written. Needs new fixtures. ⬜ Not built.

## 19. Search tool vs grep — ⬜ gap (leadtype-specific)

Leadtype ships a BM25 index + answer streaming. Does giving the agent a *search
tool* over the docs beat handing it raw files to grep? Measures whether the
search feature earns its place for agents, not just humans. ⬜ Not built.

---

## Recommended priority

Built / lands in the next run: failure-mode breakdown (#14), discovery arms (#3),
pointer arm — just need the run.

Next builds, in order:

1. **Flattened-vs-raw-MDX arm (#15)** — tests leadtype's actual thesis; reuses
   existing fixtures. Highest leadtype-specific value.
2. **Staleness / version-matching fixture (#6)** — the killer, unfakeable case
   for bundling version-matched docs. Biggest claim we *can't* currently make.
3. **Harder / novel fixtures (#8)** — without these the suite can't show docs
   help strong models; it caps every other finding.
4. **Zero-package baseline (#5)** — decomposes control; directly answers "how
   good is the LLM from code alone vs pure memory." Cheap.
5. **Tool-use realism / web-fetch arm (#10)** — could materially change the
   value story; worth knowing before publishing "bundle your docs."
6. **Honest counterweights** — adversarial stale-doc (#7) and over-trust (#17):
   when do docs *hurt*?
7. **Grounding (#16), instruction-following (#18), search-tool (#19)** — deeper
   "is it actually used / obeyed" measures once the above land.

Everything below the line (#9, #11, #12, #13) is worthwhile but lower leverage
until the above land.
