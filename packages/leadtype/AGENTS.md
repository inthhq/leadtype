# Leadtype

> A docs pipeline that turns one MDX source into a website, agent-readable bundles, and a search index.

These docs ship inside the package so coding agents can read them offline. Open the topic file you need from the list below — paths are relative to this file.

## Product Summary

- Convert MDX into clean markdown that agents and tools can read.
- Generate llms.txt and topic-scoped full-context bundles.
- Build a static search index plus optional source-grounded answers.
- Validate frontmatter, navigation, and internal links before publish.

## Best Starting Points

- [Leadtype](./docs/index.md): One MDX source. A website for humans, llms.txt for agents, and a search index — all from a single pipeline.
- [Quickstart](./docs/quickstart.md): Install leadtype, run it against a docs folder, and inspect the four artifacts it produces.
- [How it works](./docs/how-it-works.md): The mental model: one MDX source, a remark pipeline, four artifacts, three audiences.
- [Connect a docs site](./docs/build/connect-docs-site.md): Wire leadtype into a docs app build so it serves humans, agents, and search from one source.
- [Bundle docs into a package](./docs/build/bundle-package-docs.md): Ship agent-readable docs inside an npm tarball so IDEs and coding agents can read them offline.

## Get Started

What leadtype is, how it fits together, and the five-minute happy path.

- [Leadtype](./docs/index.md): One MDX source. A website for humans, llms.txt for agents, and a search index — all from a single pipeline.
- [How it works](./docs/how-it-works.md): The mental model: one MDX source, a remark pipeline, four artifacts, three audiences.
- [Methodology](./docs/methodology.md): How leadtype differs from Fumadocs, Starlight, and Mintlify.
- [Quickstart](./docs/quickstart.md): Install leadtype, run it against a docs folder, and inspect the four artifacts it produces.

## Authoring

The content contract: frontmatter, groups, and the MDX components the pipeline can flatten.

- [Components](./docs/authoring/components.md): MDX components the pipeline knows how to flatten into agent-readable markdown.
- [Frontmatter](./docs/authoring/frontmatter.md): Required fields, group semantics, and how authored MDX becomes a navigation tree.

## Build

Two journeys: ship docs inside an npm package, or wire leadtype into a docs site.

- [Bundle docs into a package](./docs/build/bundle-package-docs.md): Ship agent-readable docs inside an npm tarball so IDEs and coding agents can read them offline.
- [Connect a docs site](./docs/build/connect-docs-site.md): Wire leadtype into a docs app build so it serves humans, agents, and search from one source.
- [Validate in CI](./docs/build/validate-in-ci.md): Run leadtype lint in CI so frontmatter, navigation, and link issues fail PRs before publish.

## Reference

CLI flags, conversion APIs, remark plugins, LLM bundles, search, and lint rules.

- [CLI](./docs/reference/cli.md): leadtype generate and leadtype lint — flags, exit codes, and JSON output.
- [Convert](./docs/reference/convert.md): MDX-to-markdown conversion APIs from leadtype/convert.
- [Lint rules](./docs/reference/lint.md): Schema, link, and navigation checks. CLI and library API.
- [LLM bundles](./docs/reference/llm.md): Generate llms.txt and topic-scoped full-context files for agents.
- [Remark plugins](./docs/reference/remark.md): The default plugin stack that flattens MDX components into markdown.
- [Search](./docs/reference/search.md): Static search index, runtime helpers, and source-grounded answer streaming.
