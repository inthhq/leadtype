---
"leadtype": patch
---

Include mounts in SOURCE_CONFIG_INHERIT_FIELDS whitelist. Collection configurations that explicitly declare inherit: ["mounts"] (or include mounts alongside other inherited fields) now validate successfully instead of incorrectly rejecting mounts as an unsupported field.
