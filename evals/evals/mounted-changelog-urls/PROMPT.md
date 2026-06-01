Our repo keeps a `changelog/` folder right beside `docs/`. We want the changelog pages served under `/changelog/...` on the generated site — **not** under `/docs/changelog/...` — while still being searchable.

In `ANSWER.md`:

1. Give the single `leadtype generate` invocation that achieves this.
2. Describe what it emits for a file like `changelog/v1.mdx` — the internal generated copy, the public mirror, and the canonical URL agents see.

A `leadtype` package is already installed. Use whatever resources it provides if helpful.
