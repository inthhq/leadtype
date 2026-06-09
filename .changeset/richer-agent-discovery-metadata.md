---
"leadtype": patch
---

Emit Agent Skills discovery manifests in the v0.2.0 format ($schema plus per-entry type/url/sha256-hex digest, with legacy path/integrity kept for older consumers) and support richer Organization JSON-LD identity fields from docs config — email, sameAs, contactPoint, and address — with fail-loud validation of unknown contactPoint/address keys.
