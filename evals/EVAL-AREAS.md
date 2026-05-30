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
  wild. Run `evals:llms:discovery`.

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

---

## Recommended priority

1. **Staleness / version-matching fixture (#6)** — the killer, unfakeable case
   for bundling version-matched docs. Biggest claim we *can't* currently make.
2. **Harder / novel fixtures (#8)** — without these the suite can't show docs
   help strong models; it caps every other finding.
3. **Zero-package baseline (#5)** — decomposes control; directly answers "how
   good is the LLM from code alone vs pure memory." Cheap.
4. **Run the two new discovery arms (#3)** — already built; just needs runs.
5. **Tool-use realism / web-fetch arm (#10)** — could materially change the
   value story; worth knowing before publishing "bundle your docs."
6. **Adversarial stale-doc test (#7)** — the honest counterweight: when do docs
   hurt?

Everything below the line (#9, #11, #12, #13) is worthwhile but lower leverage
until the above land.
