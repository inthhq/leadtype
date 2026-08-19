---
"leadtype": patch
---

Hash `paths.lock.json` entries from authored source, not generated markdown.

The lockfile exists to remember published paths so a later generate can detect renames. Fingerprinting the generated `.md` mirror folded ExtractedTypeTable rows, expanded includes, and converter formatting into every hash — so working on unrelated types, running generate in `--watch`, or even regenerating with a slightly different pipeline rewrote a committed lockfile. Hashes now come from the source `.mdx`/`.md` body (frontmatter still excluded). `redirectFrom` is still read from the generated mirror, so `afterFrontmatter` transformers that add it keep working.

The next generate after upgrading rewrites hashes once. Old and new hashes cannot match, so a rename in that same generate will fail as an unmatched disappearance instead of auto-redirecting. Upgrade and rename in two separate generates (two commits). After the first rewrite, the file only changes when a page's authored body or path set changes.
