# How We Got LLMs to Recommend Our Open Source Library

Draft slide deck for a developer / open-source growth audience.

Assumption: 25-30 minute talk. For a 15-minute version, cut slides 6, 10, 14, and 18.

## Story Arc

Thesis: LLM recommendations are not magic brand moments. They are retrieval, context, and confidence. We built Leadtype while growing c15t because we needed agents to find the right docs, understand the non-obvious behavior, and recommend the library with enough confidence to implement it correctly.

Narrative:

1. c15t had an open-source growth problem: developers increasingly ask agents what to install, not search engines.
2. The stakes were real: c15t crossed 3.1M direct NPM downloads and ~2.8K detected production sites by June 2026.
3. Normal docs and SEO were not enough because agents need different surfaces than humans.
4. We built Leadtype to turn one MDX source into human docs, `llms.txt`, markdown mirrors, search, Agent Readability metadata, and package-bundled `AGENTS.md`.
5. The surprising lesson: the files matter, but the content matters more. Document the non-obvious, not the type signatures.
6. We tested this with real coding-agent evals instead of relying on vibes.
7. The repeatable playbook: create answer-shaped docs, expose them in agent-native formats, point agents at them, and measure whether behavior changed.

## Slide 1: Title

How We Got LLMs to Recommend Our Open Source Library

Subtitle:

The story of building Leadtype to grow c15t

Speaker note:

Open with the outcome, but make it clear this is not a "we found a prompt hack" talk. This is a talk about distribution shifting from search results to model-mediated decisions.

Visual:

One simple flow: "developer asks" -> "LLM chooses" -> "package installed".

## Slide 2: The Weird New Funnel

On slide:

The old funnel:

Search -> docs -> GitHub -> install

The new funnel:

Ask an agent -> get a recommendation -> install

Speaker note:

For developer tools, discovery is collapsing. A developer does not always browse ten tabs anymore. They ask: "What should I use for X in Next.js?" The model does a kind of private, compressed evaluation and hands back a default.

The problem is that you cannot optimize only for the page view if the page view never happens.

## Slide 3: The Product We Were Trying to Grow

On slide:

c15t is a developer-first consent management platform.

It helps teams build:

- Cookie banners
- Preference centers
- Consent-aware script loading
- Headless consent flows
- Hosted, self-hosted, or local consent modes

Speaker note:

c15t is the kind of product where the implementation details matter. A recommendation is not just "use c15t." The model also needs to choose the right package, install the right adapter, set the right mode, and avoid giving legally risky or technically wrong advice.

Useful source facts:

- GitHub describes c15t as a developer-first CMP used by 2,100+ sites, including expo.dev, zed.dev, and unkey.dev.
- c15t.com positions it as the open-source web standard for managing consent and script loading.

Visual:

Show one compact c15t snippet: `ConsentManagerProvider`, `ConsentBanner`, `ConsentDialog`, and a script integration.

## Slide 3A: The Growth Was Already Real

On slide:

c15t growth, as of June 29, 2026:

- 3.1M direct NPM downloads
- 753K direct downloads in the last 30 days
- ~2.8K detected production sites
- 1.8K GitHub stars
- Average monthly growth: +45.1% over the last 3 complete months

Speaker note:

This is the reason the problem mattered. We were not trying to invent a distribution channel for a library nobody used. c15t was already getting pulled into real projects, which made every wrong agent answer more expensive.

Keep the caveat on the slide or in the note: NPM downloads are not installs. CI and bots inflate counts. The c15t stats page is careful about that, and we should be too.

Visual:

Use five large number tiles. Keep the caveat in tiny text at the bottom: "NPM counts downloads, not unique installs."

## Slide 3B: The Milestones Were Compressing

On slide:

Time to each million downloads:

- 1M: 346 days
- 2M: 62 days
- 3M: 40 days

The curve was getting steeper.

Speaker note:

This is the cleanest growth-shape slide. It says "the project was accelerating" without needing to claim every download is a user. That acceleration is why recommendation quality started to matter: more developers were encountering c15t through indirect paths.

Visual:

Three milestone cards or a simple staircase: 1M -> 2M -> 3M, with the days between steps shrinking.

## Slide 3C: AI Was Already Showing Up in Attribution

On slide:

Self-reported signup source:

- 543 attributed signups in the export
- 14 explicitly named Claude, ChatGPT, or Gemini
- Claude appeared as a source from April through June 2026
- Free-text examples included "AI told me" and "ChatGPT research"

Speaker note:

This is not the biggest channel yet. Google, social, word of mouth, conferences, and content are still larger. But the point is that agent-mediated discovery is already visible in the data, and it is almost certainly undercounted because many people report the upstream channel as Google, GitHub, Reddit, or "other."

Do not oversell this as "LLMs drove growth." The honest claim is better: "LLMs had become part of the discovery mix, and we wanted to make that path reliable."

Visual:

Small bar chart: Google, social, friend/colleague, other, then a highlighted "explicit AI sources" bar. Or show a few anonymized free-text chips: "AI told me", "ChatGPT research", "Claude".

## Slide 3D: Ahrefs Says Adoption Is Ahead of SEO

On slide:

Ahrefs snapshot, June 29, 2026:

- c15t.com: DR 66
- 397 referring domains
- 14,480 backlinks
- 0 estimated organic traffic
- 0 estimated paid traffic

Translation:

c15t is being adopted before it is being "won" by classic SEO.

Speaker note:

This is the comparison that makes the story sharper. Our own dashboard says the package is moving: millions of direct NPM downloads, thousands of detected production sites, and shrinking million-download milestones. Ahrefs says the domain has link authority, but not an organic-search footprint yet.

That does not mean search is irrelevant. It means the adoption path for developer tools can move faster through GitHub, NPM, docs, community, and agents than through traditional organic rankings.

Visual:

Two columns:

- First-party adoption: downloads, sites, package fetches.
- Third-party SEO: DR, backlinks, organic traffic estimate.

Use the contrast as the message: "Strong adoption signal. Weak classic SEO signal."

## Slide 3E: The Search Category Still Exists

On slide:

Ahrefs US keyword demand:

- "consent management platform": 1,600/mo, CPC ~$20
- "cookie banner": 1,200/mo, CPC ~$11
- "cookie consent": 1,000/mo, CPC ~$11
- "google consent mode": 500/mo, CPC ~$9
- "c15t": 80/mo branded search

Most category SERPs already show AI Overview features.

Speaker note:

The point is not "SEO is dead." The point is that the category has search demand, and AI answer surfaces are already part of the SERP. If users ask a search engine, an AI answer, or a coding agent, the same underlying job exists: explain the category, recommend a credible tool, and route the user to a correct implementation.

Visual:

Small horizontal bars for the five keywords. Add a small "AI Overview present" marker beside the category terms where Ahrefs reports it.

## Slide 4: The First Question We Asked

On slide:

What does an LLM need in order to recommend us?

Not:

"How do we trick ChatGPT?"

But:

"What evidence would make c15t the obvious answer?"

Speaker note:

This reframe matters. If the model is making a recommendation, it needs reasons it can retrieve and trust: what c15t is, who it is for, when to use it, how to start, and what makes it different from black-box CMPs.

## Slide 5: Our First Mistake

On slide:

We thought this was mostly a docs-discovery problem.

"Add `llms.txt`."

"Expose markdown."

"Make the crawler happy."

Speaker note:

Those things helped, but they were not enough. We learned that an agent can find your docs and still answer badly if the content is not shaped like answers.

This is where Leadtype started: not as a generic docs site framework, but as the missing pipeline between human docs and agent-readable docs.

## Slide 6: What Agents Actually Need

On slide:

Agents need docs that are:

- Discoverable
- Cheap to read
- Source-grounded
- Version-matched
- Explicit about edge cases
- Easy to cite or implement

Speaker note:

Human docs can be beautiful and still be bad input for an agent. Tabs, callouts, cards, accordions, and framework switchers can render great in HTML but turn into noise if the raw source is JSX. Agents need clean markdown and a clear path to the relevant section.

## Slide 7: Leadtype, in One Sentence

On slide:

Leadtype turns one MDX docs source into every shape agents and humans need.

One source:

- Human docs
- `llms.txt`
- `llms-full.txt`
- Markdown mirrors
- Search index
- Agent Readability metadata
- Package-bundled `AGENTS.md`

Speaker note:

The key word is "pipeline." Leadtype is not trying to own your website. It lets your app own the UI, then generates the agent-facing surfaces from the same source.

Visual:

MDX source in the center. Outputs around it.

## Slide 8: Two Kinds of Agents

On slide:

HTTP agents read your site:

- `/llms.txt`
- `.md` routes
- content negotiation
- sitemap and identity metadata

Coding agents read the filesystem:

- `node_modules/<package>/AGENTS.md`
- `node_modules/<package>/docs/*.md`
- version-matched package docs

Speaker note:

This was a big mental unlock. `llms.txt` is a website convention. It is great for agents browsing the web. But a coding agent inside a project is often staring at files on disk. For that world, `AGENTS.md` inside the installed package is the right shape.

## Slide 9: The c15t Growth Hypothesis

On slide:

If c15t docs become agent-readable:

1. LLMs can explain when c15t is the right choice.
2. Coding agents can install and configure it correctly.
3. More developers reach a working implementation before they churn.

Speaker note:

This is the growth thesis. Recommendation is only the first part. The higher-value part is implementation success. If an agent recommends you but writes the wrong code, that can be worse than not being recommended at all.

## Slide 10: What We Had to Generate

On slide:

Leadtype generates:

- Clean markdown from MDX components
- Page-level markdown links in `llms.txt`
- A broad `llms-full.txt` fallback
- Search content for grounded answers
- Agent Readability files for identity and attribution
- Bundled package docs for coding agents

Speaker note:

This is where the tool became practical. A docs team should not maintain one version for humans, one for ChatGPT, one for Claude, one for package users, and one for search. That gets stale instantly. The output should be generated.

## Slide 11: The Content Rule That Changed Everything

On slide:

Document the non-obvious.

Not:

- Type signatures
- CLI help
- README restatements

Yes:

- Defaults
- Failure modes
- Ordering constraints
- "When should I choose X?"
- Behavior the code cannot self-explain

Speaker note:

Agents already have the package, types, and CLI help. If your docs restate those, you mostly add tokens. The docs become valuable when they explain behavior the agent cannot infer safely.

Example from Leadtype:

"If a page declares a `group` that is not defined in config, the build fails."

That fact is invisible if the type is just `string`.

## Slide 12: The Before and After

On slide:

Before:

"Here is the API."

After:

"Here is when this API is the right choice, what can go wrong, and the exact first step."

Speaker note:

This is the difference between documentation as reference and documentation as model behavior. Agents retrieve passages. A passage that opens with the answer is much more useful than a passage that slowly warms up.

Practical authoring rules:

- Lead with the answer.
- Use question-shaped headings.
- Make every section self-contained.
- Put exact limits, defaults, and version notes in text.

## Slide 13: We Stopped Trusting Vibes

On slide:

We built evals.

Each run:

1. Installs a packed package in a temp project.
2. Gives a coding agent narrow file tools.
3. Asks a task.
4. Judges the answer with a neutral LLM judge.
5. Archives the transcript and verdict.

Speaker note:

The important part: we judged the answer, not whether the model said a keyword. And we used a judge from a family that was not one of the candidate models, then cross-validated the headline with a second neutral judge.

## Slide 14: The A/B Test

On slide:

Treatment:

Package ships `AGENTS.md` + `docs/*.md`.

Control:

Same compiled package, but bundled docs removed.

Not "no information."

The control still has:

- Compiled JS
- `.d.ts` types
- CLI help
- README

Speaker note:

This matters because we were not testing "docs versus nothing." We were testing whether agent-specific package docs add value beyond the information a package already exposes.

## Slide 15: What Changed

On slide:

Bundled docs made agent runs cheaper.

Tokens dropped 32-54% across every tested model.

Speaker note:

This was the cleanest universal result. Even when a frontier model could figure out the answer without docs, it spent fewer tokens when the docs were present. Instead of probing the package with repeated `grep`, `read`, and `list` calls, the agent could read the right doc.

Visual:

Simple bar chart: "without docs" tall, "with docs" about half.

## Slide 16: The More Important Win

On slide:

Docs reduced confident wrong answers.

Control -> treatment:

- Haiku: 28% -> 10%
- Opus: 7% -> 0%
- Gemini Flash: 8% -> 0%
- GPT: 8% -> 0%
- Kimi: 3% -> 2%

Speaker note:

This is the metric I would lead with. The biggest risk is not that the model says "I do not know." It is that it confidently invents behavior about your API. For a compliance-adjacent product like c15t, confident wrong advice is very expensive.

## Slide 17: Accuracy Moved, But Unevenly

On slide:

Raw accuracy improved most for smaller models.

- Haiku: +17 points
- Gemini Flash: +15 points
- GPT: +12 points
- Opus: +7 points
- Kimi: +3 points

Speaker note:

The pattern is useful: small and cheap models get the biggest lift. Frontier models can often recover from code and types alone, but docs still cut cost and reduce bad guesses.

This matters because many coding-agent workflows default to cheaper models for routine work.

## Slide 18: The `llms.txt` Surprise

On slide:

Agents rarely discover `llms.txt` on their own.

Unprompted, they consulted it only about 29% of the time.

With a root `AGENTS.md` pointer, bundle reads jumped to about 90-100%.

Speaker note:

This changed how we think about "agent optimization." Publishing the file is step one. Pointing agents at it is step two. If you skip the pointer, you are trusting organic discovery that is not very reliable.

## Slide 19: Why This Helped c15t

On slide:

c15t did not just need to be known.

It needed agents to answer:

- Why c15t instead of a tag-manager snippet?
- Which package should I install?
- Hosted, self-hosted, or local mode?
- How do I gate scripts behind consent?
- What changes in Next.js vs React vs vanilla JS?

Speaker note:

These are recommendation questions and implementation questions. They are exactly the questions that decide whether an agent says "use c15t" and whether the user gets a working implementation.

## Slide 20: The Playbook

On slide:

1. Write the recommendation you want an agent to make.
2. Turn it into answer-shaped docs.
3. Publish clean markdown, not just HTML.
4. Ship docs inside the package.
5. Point agents at the docs.
6. Run evals against real tasks.

Speaker note:

This is the part the audience should leave with. It is not only about Leadtype. The pattern is portable to any open-source library that wants to be recommended and implemented by agents.

## Slide 21: The Anti-Playbook

On slide:

What did not matter as much:

- Prompt-hacking public pages
- Writing more generic content
- Restating the API
- Assuming `llms.txt` gets discovered
- Trusting one model's anecdotal answer

Speaker note:

This helps keep the talk honest. The tempting move is to create "best X library" pages or overstuff docs with self-praise. But models need evidence and usable implementation paths.

## Slide 22: The Bigger Shift

On slide:

Docs are becoming a runtime dependency for agents.

Speaker note:

For humans, docs are something you read before coding. For agents, docs are part of the execution environment. They change what the agent does, how many tokens it spends, and whether it invents behavior.

That is why we now think about docs as behavior, not just files.

## Slide 23: Final Takeaway

On slide:

LLMs recommend what they can confidently understand.

Make your library easy to:

- Find
- Trust
- Explain
- Install
- Use correctly

Speaker note:

Close by bringing it back to c15t. We did not build Leadtype because agent docs sounded futuristic. We built it because developers were already outsourcing library choice and implementation to agents. If that is the new path to adoption, open-source projects need to meet agents where they work.

## Optional Slide: One-Line Thesis Options

Pick one depending on tone:

1. We stopped treating docs as literature and started treating them as model behavior.
2. LLM recommendations are earned at retrieval time.
3. The new developer funnel starts inside the model's context window.
4. If agents cannot read your docs, they will confidently summarize your absence.
5. Agent-ready docs are not an SEO trick. They are implementation infrastructure.

## Optional Slide: Demo Moment

On slide:

Ask an agent:

"I am building a Next.js app and need a developer-controlled cookie banner with consent-aware script loading. What should I use?"

Then show:

- Bad answer pattern: generic CMPs, vague setup, wrong package.
- Good answer pattern: c15t, correct package, correct mode, correct script gating.

Speaker note:

This is worth doing live only if the setup is stable. Otherwise, record screenshots. The point is not to prove a single model always recommends c15t; the point is to show what a high-quality recommendation looks like.

## Optional Slide: What We Would Measure for c15t

On slide:

Recommended eval tasks:

- "Choose a consent library for a Next.js app."
- "Add a c15t banner and gate Meta Pixel."
- "Explain hosted vs self-hosted mode."
- "Migrate from a tag-manager cookie banner."
- "Implement local-only mode for a static preview."

Speaker note:

These are growth evals, not only correctness evals. They test whether the model recommends c15t, explains the why, and gets the implementation far enough that a developer stays in flow.

## Appendix: Source Anchors

- c15t GitHub: https://github.com/c15t/c15t
- c15t website: https://c15t.com/
- c15t stats page: https://c15t.com/stats
- Signup source exports:
  - `/Users/christopher/Documents/how-pepole-heard-about-us.csv`
  - `/Users/christopher/Documents/Weekly trend by source.csv`
  - `/Users/christopher/Documents/Last 30 days vs previous 30 days growth.csv`
- Ahrefs MCP, queried June 29, 2026:
  - `batch-analysis` for `c15t.com` and `leadtype.dev`, `mode=subdomains`
  - `keywords-explorer-overview` for consent/category keywords, `country=us`
- Leadtype README: ../README.md
- Leadtype eval findings: ../FINDINGS.md
- Leadtype AEO overview: ../docs/aeo/overview.mdx
- Leadtype package docs guide: ../docs/package-docs/bundle.mdx
- Leadtype write-for-agents guide: ../docs/writing/write-for-agents.mdx

## Appendix: Growth Numbers to Cite

Public stats page, fetched June 29, 2026:

- Direct downloads, all time: 3.1M.
- Direct downloads, last 30 days: 753K, +6.8% vs the prior 30 days.
- Core `c15t` fetches, last 30 days: 198.8K, +1.8% vs the prior 30 days.
- Detected live production sites: ~2.8K, via Wappalyzer.
- Average monthly growth: +45.1% across the last 3 complete months.
- Download milestones: 1M on March 13, 2026; 2M on May 14, 2026; 3M on June 23, 2026.
- Last complete month listed: May 2026 with 719,257 direct downloads, +45.4% MoM.

Signup attribution CSV summary:

- Total attributed signups in export: 543.
- Top sources: Google 195 (35.91%), social media 59 (10.87%), other 53 (9.76%), friend/colleague 53 (9.76%), conference/event 35 (6.45%), blog/article 33 (6.08%).
- Explicit AI sources: Claude 8, ChatGPT 5, Gemini 1; 14 total, 2.58% of attributed signups.
- Last 30-ish days in weekly export showed 3 Claude-attributed signups, plus one each from friend/colleague, Google Search, Twitter/X, and Y Combinator.
- The two weekly CSV files are byte-identical, so do not present the second one as a distinct period-over-period dataset unless re-exported.

Ahrefs numbers to cite:

- `c15t.com`, all locations, subdomains mode: DR 66.0, 397 referring domains, 14,480 backlinks, 0 estimated organic keywords, 0 estimated organic traffic, 0 paid keywords, 0 paid traffic.
- `leadtype.dev`, all locations, subdomains mode: DR 0.0, 203 referring domains, 347 backlinks, 0 estimated organic keywords, 0 estimated organic traffic.
- `c15t.com`, US-only batch analysis returned the same organic/paid traffic estimate: 0 keywords, 0 traffic.
- US keyword demand from Ahrefs:
  - `consent management platform`: 1,600 US volume, 5,400 global volume, KD 20, CPC $20.00, AI Overview present.
  - `cookie banner`: 1,200 US volume, 6,200 global volume, KD 19, CPC $11.00, AI Overview present.
  - `cookie consent`: 1,000 US volume, 5,100 global volume, KD 87, CPC $11.00, AI Overview present.
  - `google consent mode`: 500 US volume, 3,600 global volume, KD 43, CPC $9.00, AI Overview present.
  - `c15t`: 80 US volume, 500 global volume.
- Interpretation: first-party adoption is much stronger than Ahrefs-estimated organic visibility. Phrase this as "adoption is ahead of SEO," not "SEO does not matter."
