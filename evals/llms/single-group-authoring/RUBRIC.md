# Rubric: frontmatter `group` and monolithic output

Task: summarize how frontmatter `group` controls navigation and monolithic output (`/llms-full.txt`), and include at least two optional frontmatter fields.

Ground truth: `group` is (legacy) taxonomy metadata. It drives the fallback **navigation tree**, the **section headings in `llms.txt`**, **search metadata/facets**, and **`AGENTS.md`** grouping. The root **`/llms-full.txt`** is a single **monolithic, all-docs flattened** fallback — `group` organizes routing/sections, it does **not** shard `llms-full.txt` into per-group files (site mode no longer emits per-group full-context files by default). Optional frontmatter fields include `icon`, `deprecated`, `experimental`, `canary`, `new`, `draft`, `tags`, `full`, plus the git-derived `lastModified`/`lastAuthor`.

## REQUIRED — all must be satisfied
- Explains that `group` organizes **navigation** and/or **`llms.txt` sections / `AGENTS.md` grouping** (not just decoration).
- Characterizes **`/llms-full.txt`** as the **monolithic all-docs** file (a single flattened fallback), i.e. it is not split per group.
- Names **at least two** valid optional frontmatter fields (from the list above).

## Incorrect if
- Claims `/llms-full.txt` is generated per-group / sharded by group.
- Lists fewer than two optional fields, or invents fields not in the schema.
