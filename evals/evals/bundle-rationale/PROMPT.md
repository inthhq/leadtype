A teammate is about to publish our library on npm and wants coding agents to read its docs after `npm install`. They propose dropping an `llms.txt` file inside the published package.

In one or two short paragraphs written to `ANSWER.md`:

1. Explain why `AGENTS.md` — not `llms.txt` — is the right shape for docs that ship *inside* an npm tarball.
2. List which website artifacts `leadtype generate --bundle` deliberately skips, and why they don't belong in a package.

A `leadtype` package is already installed. Use whatever resources it provides if helpful.
