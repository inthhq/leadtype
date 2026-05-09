Add a GitHub Actions workflow at `.github/workflows/lint-docs.yml` that runs `leadtype lint` against the `docs/` directory on every pull request that touches docs files.

Requirements:

1. Trigger on `pull_request` events that change files matching `docs/**` or `**/*.mdx`.
2. Use the GitHub Actions annotation format so violations show up as inline comments on the PR.
3. Treat unknown frontmatter fields as errors (strict mode).
4. Fail the job if there are any warnings.

A `leadtype` package is already installed. Use whatever resources it provides if helpful.
