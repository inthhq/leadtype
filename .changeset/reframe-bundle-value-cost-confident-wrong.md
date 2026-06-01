---
"leadtype": patch
---

Reframe the docs/marketing pitch for bundling around the universal, defensible wins — cost and confident-wrong reduction — instead of raw accuracy (closes #68).

The eval runs show the accuracy lift is modest and judge-sensitive for frontier models, while two wins hold for *every* model: bundled docs cut per-run tokens 32–54%, and they stop agents confidently asserting the wrong behavior about your API. The copy now leads with those:

- The README and docs landing (`index.mdx`) bundle paths, the `Bundle docs into a package` guide, and the package-docs card now lead with "agents run cheaper and stop confidently guessing wrong about your API," with accuracy framed by model tier ("biggest for the small, cheap models most agents run").
- The `Evals` page reorders the package-benchmark section to present cost first, then confident-wrong, then accuracy-by-tier (with a confident-wrong table), instead of leading with the accuracy-lift table.

Docs only — no API or behavior change. The reframed copy reaches consumers through the regenerated bundled docs in the published tarball.
