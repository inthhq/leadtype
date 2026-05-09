This is a stub library that wants to ship agent-readable docs inside its npm tarball so coding agents can discover them after `npm install`.

Configure it:

1. Update `package.json` so `AGENTS.md` ships in the published files.
2. Add a `prepack` script that runs `leadtype generate --bundle` from the repo root (`../../`) into the package directory (`.`).
3. Add a stub `docs/index.mdx` at the repo root with valid frontmatter (title, description, group) so the pipeline has something to convert.

Run `npm pack --dry-run` and confirm `AGENTS.md` and at least one `.md` under `docs/` appear in the file list.

A `leadtype` package is already installed. Use whatever resources it provides if helpful.
