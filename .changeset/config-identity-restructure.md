---
"leadtype": minor
---

Restructure `defineDocsConfig` around three clear concepts: **identity** (`product` + `organization`), **content** (`llms`), and **navigation** — so it's obvious what each field is for and where it ends up.

**Breaking config changes** (all shipping in this release):

| Before | After |
| --- | --- |
| `product.summary` | `product.tagline` |
| `product.blocks` | `llms.sections` |
| `nav` (top-level + per-collection) | `navigation` |
| `agents.jsonLd.organization` | top-level `organization` |
| `agents.jsonLd.software.isLibrary` | `product.kind: "library"` |
| `agents.jsonLd.software.applicationCategory` | `product.category` |
| `agents.skills.agentCard` | `agents.agentCard.enabled` |

`product` is now pure identity (`name`, `tagline`, `homepage`, `docs`, `repository`, `kind`, `category`) reused across `llms.txt`, JSON-LD, and the agent card. `organization` (who publishes the product) feeds the JSON-LD `Organization` node and the agent-card `provider` — resolving the old ambiguity of whether `organization` meant the product or its maintainer. `product.repository` is emitted as JSON-LD `codeRepository`; `product.docs` becomes the agent-card `documentationUrl`.

New exported helper `resolveAgentInputs(config)` translates the config's identity blocks into the low-level generator inputs (`generateLlmsTxt`, `generateAgentReadabilityArtifacts`, `generateSkillArtifacts`), so code composing those generators by hand shares one mapping with `leadtype generate`.

Also fixes a latent bug where `leadtype generate` dropped the entire `agents` block during config validation (only the programmatic generator path honored it).
