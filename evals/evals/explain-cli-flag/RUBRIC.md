# Rubric: explain `--enrich-git`

The task asks the agent to explain, in one paragraph written to `ANSWER.md`, what the `--enrich-git` flag does on `leadtype generate`.

Ground truth: `--enrich-git` adds the frontmatter fields **`lastModified`** and **`lastAuthor`**, populated from the page's **git history**. These fields are filled in automatically by this flag and are not meant to be authored by hand.

## REQUIRED — all must be satisfied
- Names **both** frontmatter fields: `lastModified` **and** `lastAuthor`.
- States they are added to (page) **frontmatter**.
- States the values come from **git history** / git metadata.

## Incorrect if
- Names only one of the two fields, or invents other field names.
- Attributes the values to something other than git (e.g. file mtime, build time, config).
- Describes a different flag's behavior.
