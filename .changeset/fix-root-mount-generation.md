---
"leadtype": patch
---

Support root-mounted Markdown mirrors without deleting primary docs, other mounts, or unrelated Markdown files in the output directory. Use current source pages to distinguish primary docs from mirrors, and track generated mirrors in a per-user cache outside the published directory and prune only previously generated files whose content is unchanged. Files left by older releases without ownership records are preserved. Filtered builds keep excluded mirrors, and unavailable cache storage does not fail generation.
