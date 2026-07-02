# Sitemap

Structured documentation sitemap for Leadtype.

## Concepts

- [Methodology](/docs/concepts/methodology): Where leadtype fits alongside custom docs apps and frameworks like Fumadocs and Starlight — the portable content and agent-readability layer underneath the host you choose.
- [Architecture](/docs/concepts/architecture): The core / adapter boundary — what ships where, and the rules adapters must follow.
- [Evals](/docs/concepts/evals): How Leadtype measures whether bundling agent docs actually helps coding agents — and how the llms.txt defaults were chosen.

## Docs Pipeline

### Sources

- [Configure docs sources](/docs/pipeline/configure-sources): Choose where Leadtype reads MDX from: one local docs folder, multiple mounted folders, or remote git collections pinned to a branch, tag, or commit.
- [Collections reference](/docs/pipeline/collections): Detailed defineCollection behavior for multi-source docs: local folders, git repos, filters, schemas, and per-collection navigation.
- [Sync docs across repositories](/docs/pipeline/sync-docs-across-repos): Keep a separate docs UI repository pinned to a reviewed package-docs source revision.

### Build

- [Build an agent-ready docs site](/docs/pipeline/build-a-docs-site): Pick the right Leadtype integration shape for a hosted docs site with rendered pages, markdown mirrors, llms.txt, search, and agent metadata.
- [Use the source primitive](/docs/pipeline/use-the-source-primitive): Wire createDocsSource into Next, TanStack Start, Nuxt, Astro, SvelteKit, or any MDX-aware bundler. Same primitive, multiple host shapes.
- [Agent setup prompts](/docs/pipeline/agent-setup-prompts): Copyable prompts that let a coding agent wire Leadtype into your app — local docs, external/multi-repo docs, or a package bundle — adapting to your real layout.

### Generate & operate

- [Generate static artifacts](/docs/pipeline/generate-static-artifacts): Run leadtype generate from your build pipeline to write llms.txt, markdown mirrors, search index, sitemap, and agent-readability files to disk.
- [Generate RSS and Atom feeds](/docs/pipeline/generate-rss-atom-feeds): Configure Leadtype to emit RSS and Atom feeds for changelogs, blogs, release notes, or any URL-prefixed generated docs content.
- [Deploy generated artifacts](/docs/pipeline/deploy-generated-artifacts): Serve Leadtype output on common framework and hosting combinations.
- [Validate in CI](/docs/pipeline/validate-in-ci): Run leadtype lint in CI so frontmatter, navigation, and link issues fail PRs before publish.
- [Localize docs](/docs/pipeline/localize-docs): Author multi-locale MDX, generate per-locale llms.txt and markdown mirrors, and serve locale-prefixed docs with alternate-locale links.

## AEO & Agent Readability

- [AEO & Agent Readability overview](/docs/aeo/overview): Every agent-facing artifact leadtype emits, how they map to the agent-readability spec and AEO scoring rubrics, and how to audit a site.
- [Optimize docs for agents](/docs/aeo/optimize-docs-for-agents): Generate llms.txt, markdown mirrors, JSON-LD inputs, sitemaps, robots.txt, and agent-readability.json from one CLI run.
- [Generate artifacts without a docs tree](/docs/aeo/generate-artifacts-without-docs): Emit llms.txt, markdown mirrors, sitemaps, robots.txt, and the agent-readability manifest from an in-memory page list — no .mdx source files required.
- [Serve agent responses](/docs/aeo/serve-agent-responses): Wire markdown responses, JSON-LD, sitemap, and robots into your framework using the generated agent-readability.json manifest.
- [Agent skills](/docs/reference/skills): Emit a discoverable SKILL.md surface (agentskills.io) from docs.config.ts — an auto docs-skill plus any you declare — to /.well-known/agent-skills and the package bundle.
- [MCP server](/docs/reference/mcp): Serve docs to MCP clients over stdio or Streamable HTTP — the gate for when it's worth it, the optional-peer-dep and stateless-HTTP gotchas, and how edge/bundled hosts skip the disk path.
- [WebMCP](/docs/reference/webmcp): Register generated docs as browser-side WebMCP tools with document.modelContext / navigator.modelContext — separate from the server MCP endpoint.
- [NLWeb](/docs/reference/nlweb): Serve an NLWeb /ask endpoint over your generated docs and publish the schema feeds + robots.txt Schemamap directive that make the site conversational for agents.

## Writing for Agents

- [Write for agents & GEO](/docs/writing/write-for-agents): Authoring for agents and the answer engines that cite you, in two halves: what to write (the non-obvious, not restatement) and how to structure it (lead with the answer, question-form headings, self-contained sections).
- [Frontmatter](/docs/writing/frontmatter): Required fields, optional taxonomy metadata, and how authored MDX becomes a navigation tree.
- [Components](/docs/writing/components): MDX components the pipeline knows how to flatten into agent-readable markdown.

## Search & AI Answers

- [Add search](/docs/search/add-search): Generate a static docs search index, query it at runtime, and wire a search UI with the React, Vue, or Svelte hooks.
- [Stream AI answers](/docs/search/ai-answers): Source-grounded answer streaming over the static index — Vercel AI SDK, TanStack AI, or Cloudflare Workers AI — behind a hardened endpoint.
- [Agent search tools](/docs/search/agent-tools): Expose docs as a read-only virtual filesystem so an agent can explore with ls, cat, find, grep, and rg instead of receiving pre-selected chunks.

## Package Docs

- [Bundle docs into a package](/docs/package-docs/bundle): Ship agent-readable docs inside an npm tarball — AGENTS.md at the package root plus per-topic .md files.

## Integrations

- [Framework integration matrix](/docs/integrations/framework-matrix): Use Leadtype with native-feeling recipes for Next, TanStack Start, Nuxt, Astro, SvelteKit, and Fumadocs.
- [Integrate with Fumadocs](/docs/integrations/integrate-with-fumadocs): Wire leadtype's content layer into a fumadocs app for nav, search, and includes.

## Reference

- [CLI](/docs/reference/cli): leadtype init, generate, sync, lint, mcp, and score — flags, exit codes, and JSON output.
- [createDocsSource](/docs/reference/source): Framework-neutral docs source primitive — navigation, page loader, search index, and include resolver.
- [LLM files](/docs/reference/llm): Generate llms.txt for hosted websites and AGENTS.md for npm-bundled offline reading.
- [Convert](/docs/reference/convert): MDX-to-markdown conversion APIs from leadtype/convert.
- [Lint rules](/docs/reference/lint): Schema, link, and navigation checks. CLI and library API.
- [Frontmatter transformers](/docs/reference/frontmatter-transformers): Define typed custom frontmatter and lifecycle hooks for Leadtype pipeline data.
- [leadtype/mdx](/docs/reference/mdx): Tag type contracts and the build-time source preset for consumers rendering MDX themselves.
- [Markdown transforms](/docs/reference/markdown): The default transform stack that flattens MDX components into markdown.
- [OpenAPI](/docs/reference/openapi): Generate native MDX API reference pages from OpenAPI 3.x specs.
- [Search](/docs/reference/search): API surface for leadtype/search: index generation, runtime query, framework hooks, answer streaming, bash tools, and endpoint guards.
- [i18n](/docs/reference/i18n): Localization config, locale-aware URL helpers, alternate-locale links, and the per-locale artifact manifest from leadtype/i18n.
- [Troubleshooting](/docs/reference/troubleshooting): Common Leadtype errors — missing manifests, unknown groups, broken includes, content negotiation, and the base-url audit mismatch — with fixes.

## Changelog

- [Leadtype 0.4](/changelog/0-4): Release notes in progress for the next Leadtype minor release.
- [Leadtype 0.3](/changelog/0-3): Release notes for Leadtype 0.3, focused on browser-side WebMCP docs tools, RSS and Atom feed generation, and URL-prefixed docs content.
- [Leadtype 0.2](/changelog/0-2): Release notes for Leadtype 0.2, released June 3, 2026.

## Leadtype REST API

Generated from docs/openapi/leadtype-api.yaml to dogfood native API reference pages.

### Operations

- [Search docs](/docs/rest-api/operations/search-docs): Search a generated Leadtype docs index and return matching docs chunks.

## Other

- [Leadtype](/docs): Build agent-ready docs from MDX: rendered pages, llms.txt, markdown mirrors, search output, and package-bundled AGENTS.md from the same source.
- [Quickstart](/docs/quickstart): Build an agent-ready docs site from one MDX page: render it, generate llms.txt and markdown mirrors, then verify the output.
- [How it works](/docs/how-it-works): The mental model: one MDX source, a markdown transform pipeline, two output modes, three audiences.
