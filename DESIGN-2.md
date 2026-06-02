# DESIGN: agent surface II — skills, GEO, SEO polish

Status: proposed · One coherent release · Owner: Kaylee · Builds on [DESIGN.md](./DESIGN.md)

## Why

The [agent surface](./DESIGN.md) release put leadtype at parity-or-ahead of Mintlify on the
**Identity** lane (llms.txt + `.well-known` discovery, robots/Content-Signals, JSON-LD graph,
docs MCP). Reading Mintlify's docs surfaced three things still worth doing — one net-new
surface, one authoring story, and small parity gaps:

| Mintlify has | leadtype today | Gap |
|---|---|---|
| `skill.md` at `/.well-known/agent-skills/…` | — | **Net-new.** `SKILL.md` is Anthropic's open [agentskills.io](https://agentskills.io) standard, adopted by Claude Code, Cursor, Codex, Copilot, Gemini CLI, and ~40 agents. A discoverable skills surface is the strongest move toward ora's **Agent Integration** dimension. |
| GEO writing guide | `write-for-agents.mdx` (what to write) | We cover *what to write* (gotchas, eval-backed); we don't cover *how to structure* for answer engines. |
| `mint score` | `leadtype lint` (+ jsonld rule) | No agent-readiness score; no structural GEO checks. |
| og:image / twitter / keywords; `/.well-known/llms-full.txt` | og:title/description + JSON-LD via `createDocsHead`; `.well-known/llms.txt` only | Small parity gaps. |

**Honest framing (carry into docs), same as the first release:** `SKILL.md` describes
*capabilities an agent can use*. leadtype's lane is docs/identity, so the skill we *generate* is
a **"read these docs / use this docs MCP" onboarding skill** — real, in-lane, and useful.
Product-capability skills (driving your API) are author-declared, because that's the backend's
job, not a docs pipeline's. We emit the **discovery surface**; the host/author owns the claims.

## Principles / constraints (unchanged from DESIGN.md)

- **Layer, not backend.** Static files + mountable handlers only. No owned port/host/auth.
  Skills are emitted as static `.well-known` files; we never run an A2A endpoint.
- **No UI, ever.** Rules out generating social-card *images* (needs rendering). We emit the
  *metadata* (og:image URL, twitter tags); the host supplies/render the image.
- **One source, zero drift.** Every new output is another consumer of artifacts/frontmatter we
  already build. The auto docs-skill is derived from `product` + the existing docs index.
- **Build on open standards.** `SKILL.md` per [agentskills.io](https://agentskills.io)
  (Anthropic's open format). The `.well-known` *hosting/discovery* convention is still emerging
  (Mintlify's `index.json` shape) — pin to it, design the emitter so the shape is swappable.

## Components

### 1. Skills surface — `/.well-known/agent-skills` + `SKILL.md` (headline, net-new)

Emit a discoverable skills surface from one config block. Two kinds of skill, one emitter:

- **Auto docs-skill** (zero-config): a `<product>-docs` skill whose `SKILL.md` is a thin
  pointer — *"to work with `<product>`, read its docs"* — that adapts to **whichever surfaces
  exist**, in preference order:
  - **Bundle mode** (the package shipped its docs): point at the on-disk
    `node_modules/<pkg>/AGENTS.md` → `docs/*.md` (offline, relative, version-matched). The skill
    ships *inside the tarball* next to `AGENTS.md`, so an installed package is skills-discoverable
    on the filesystem — the same story as `AGENTS.md`, one level up.
  - **Site mode**: point at `/llms.txt` (+ the markdown mirror), and, **if `agents.mcp` is
    enabled**, "connect the docs MCP server" for targeted retrieval.

  It stays a *pointer*, not a third copy of the docs — progressive disclosure means the agent
  loads name+description first and only reads the body (which says where to go) when relevant.
  Derived from `product` + the surfaces already configured; zero drift.
- **Author override / capability skills**: `agents.skills.items[]` — `{ name, description,
  license?, compatibility?, allowedTools?, body | bodyPath }`. An author who already has a more
  detailed skill (e.g. a real capability skill, or a richer docs skill) declares it here; it's
  emitted alongside — or *instead of* — the auto docs-skill (`docsSkill: false` to drop the auto
  one entirely).

Emitted (static, from `generate`):

- Site mode:
  - `/.well-known/agent-skills/index.json` — discovery manifest (name + description per skill +
    path + integrity hash) for progressive disclosure.
  - `/.well-known/agent-skills/<name>/SKILL.md` — per-skill file (agentskills.io frontmatter +
    instructions body).
  - `/.well-known/agent-card.json` — optional A2A agent card pointing at the skills + MCP.
- Bundle mode (`--bundle`): the docs-skill `SKILL.md` ships in the tarball (relative,
  offline-pointing), next to `AGENTS.md` — discoverable from `node_modules/<pkg>`.

**Gate:** the auto docs-skill is free and always points agents at *some* docs surface, so it's
default-on. Capability skills are opt-in. We **never** invent capability claims — those are the
author's (and the backend's) to declare.

### 2. "Write for agents & GEO" — merged authoring page (+ restructure our own docs)

Merge the GEO structural guidance into the existing `write-for-agents.mdx`, retitled
**"Write for agents & GEO"** so it's discoverable. Two sections, one page:

- **What to write (the non-obvious)** — the current eval-backed content: document gotchas, not
  restatement; the litmus test; the confident-wrong + 32–54%-token evidence.
- **How to structure for answer engines (GEO)** — net-new: question-form headings;
  lead-with-the-answer; self-contained sections; exact specifics (status codes, ranges, not
  "flexible"); one term per concept; sequential heading hierarchy (no skips); language-labeled
  code; image alt text; "the API key", not "it". **Our edge:** Mintlify *asserts* these help;
  we tie each to our eval evidence where we have it. The only GEO guide backed by numbers.

Then **apply it to leadtype's own docs** — restructure for lead-with-answer + question headings,
fix heading-level skips, label code fences. Dogfood the guidance.

### 3. GEO enforcement — `leadtype lint` rules **+** `leadtype score`

Both, because they serve different moments (CI gate vs. headline number):

- **`leadtype lint` gains `geo:*` rules** (warn): `geo:heading-skip` (H2→H4),
  `geo:code-language` (unlabeled fence), `geo:image-alt` (missing alt). Structural, deterministic,
  CI-friendly — alongside the existing `jsonld` rule. Warn, not error (legitimate exceptions
  exist; `--max-warnings` can gate).
- **`leadtype score`** — new command. The goal is to **coach users toward a high external
  agent-readiness scan** — the high-visibility kind like [ora.ai/score](https://ora.ai/score/c15t.com)
  — by scoring locally against **that same rubric** and telling them exactly what to fix. It maps
  to ora's dimensions (the table in [DESIGN.md](./DESIGN.md)):
  - **Identity** (24→leadtype's core lane): llms.txt + `.well-known`, valid JSON-LD graph,
    sitemap/robots/Content-Signals, metadata completeness, the `geo:*` structure signals.
  - **Agent Integration** (partial): MCP artifacts present, skills surface emitted.
  - **Discovery / Auth & Access / UX**: shown but marked **out of leadtype's lane** with a
    one-line "why" + pointer (answer-engine recall is brand/training; auth is your backend; MCP
    *Apps* need UI) — so a user understands their ora gap without leadtype pretending to fix it.

  Honest by construction: it scores **what leadtype emits + your doc structure** (a local proxy
  for the external scan), and never implies it measures live answer-engine ranking. Output is a
  0–100 with the per-dimension breakdown + the top concrete fixes; `--json` for CI/dashboards.
  The win: a user runs `leadtype score`, fixes what it flags, and their *real* ora-style scan on
  the Identity/Integration lanes goes up.

### 4. SEO + discovery parity (fold-in)

- Enrich `createDocsHead` to also emit `og:image`, `twitter:card`/`twitter:image`, and
  `keywords` — author-supplied via frontmatter/`agents.seo` (no image *generation*; layer/no-UI).
- Emit `/.well-known/llms-full.txt` alongside the existing `/.well-known/llms.txt`.

## Config surface

Extends the additive `agents` block from DESIGN.md (all optional; zero-config holds):

```ts
defineDocsConfig({
  product: { name, summary },
  agents: {
    mcp, robots, jsonLd,            // shipped (DESIGN.md)
    skills: {
      docsSkill: true,             // auto "use these docs" skill (default true)
      agentCard: true,             // emit /.well-known/agent-card.json
      items: [                     // author-declared capability skills
        { name, description, license?, compatibility?, allowedTools?, bodyPath },
      ],
    },
    seo: { ogImage?, twitter?, keywords? },   // defaults for head meta; frontmatter overrides
  },
});
```

## CLI surface

- **`leadtype score`** — new. 0–100 + breakdown; `--json`; non-zero exit under a `--min`.
- **`leadtype lint`** — adds `geo:heading-skip`, `geo:code-language`, `geo:image-alt`.
- **`leadtype generate`** — also emits `/.well-known/agent-skills/*`, `/.well-known/agent-card.json`,
  `/.well-known/llms-full.txt`. Driven by the `agents` block; zero new required flags.

## Resolved decisions

- **Authoring page:** one merged page titled **"Write for agents & GEO"** (not two pages, not
  the old title) — GEO named in the title for discoverability.
- **Skills:** **auto docs-skill + author-declared.** The auto docs-skill is a *pointer* that
  adapts to the available surface — bundled `AGENTS.md`/`docs` offline, else `/llms.txt` + the
  MCP server when enabled — and ships in the tarball next to `AGENTS.md` in bundle mode. Authors
  add richer/capability skills via `items[]`, or drop the auto one with `docsSkill: false`.
- **GEO enforcement:** **both** — `geo:*` lint rules (CI gate) *and* `leadtype score`.
- **`score` purpose:** **coach toward a high external scan** (ora.ai/score-style). It maps to
  ora's rubric, scores the leadtype-addressable lanes (Identity, partial Integration), and marks
  the rest out-of-lane with a pointer — a local proxy that tells users what to fix, never
  claiming to measure live answer-engine ranking.

## Non-goals (say so plainly)

- Generating social-card **images** (no rendering — emit the `og:image` URL only).
- Hosting skills, an A2A endpoint, or any runtime — static `.well-known` emit only.
- Authoring **capability** claims for the user (we generate only the docs-onboarding skill).
- A full Schema.org / GEO validator — `leadtype score` and `geo:*` are heuristics over what we
  emit, not a guarantee of answer-engine ranking.
- Moving ora's **Discovery** (answer-engine recall) — still not a docs tool's job.

## Phasing (within the one release)

1. **"Write for agents & GEO"** merged page + restructure our own docs. Docs-first: it's the
   reference the rest leans on, lowest risk, immediately useful.
2. **GEO lint rules + `leadtype score`.** Turns the guide into something automatable; `score`
   gives the headline. Reuses the lint pipeline.
3. **Skills surface** (`/.well-known/agent-skills` + `SKILL.md` + auto docs-skill + author items
   + agent-card). The net-new surface; new public files + config.
4. **SEO meta + `/.well-known/llms-full.txt`.** Parity polish; fold in alongside.

Ships as a series of tested, committed steps — each with its own changeset and docs — like the
first release.

## Open questions / risks

- **`.well-known` skills discovery shape:** the `SKILL.md` *format* is standardized
  (agentskills.io); the `index.json` discovery/hosting convention is Mintlify's and still
  emerging. Pin to it, isolate the emitter so the shape is a mechanical swap. Confirm the
  `index.json` + integrity-hash shape against any ratified spec at impl.
- **`leadtype score` weights:** rubric mapped to ora (resolved); still open is the *per-signal
  weighting* within each dimension and the exact `--min` gate behavior. Tune against a few real
  sites (run ora on them, compare).
- **GEO lint false positives:** heading skips and unlabeled fences have legitimate exceptions →
  warn-level, ignorable, never error by default.
- **Bundle SKILL.md placement:** exact on-disk path for the bundled skill (top-level `SKILL.md`
  vs a `skills/` folder) so filesystem agents find it the way they find `AGENTS.md` — confirm
  against how Claude Code / Cursor discover on-disk skills.
- **`agents.seo` vs frontmatter precedence:** per-page frontmatter must win over config defaults
  (same precedence rule as the rest of the pipeline).
