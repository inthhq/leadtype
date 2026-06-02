---
"leadtype": minor
---

Add a JSON-LD validity check to `leadtype lint`, plus an exported `validateJsonLd`.

`leadtype lint` gains a `jsonld` rule (warn): it renders the identity fields each page's
`TechArticle` is built from and structurally validates them, catching the common breakage —
a `lastModified`/`last_updated` value that isn't a valid date, which would emit a broken
`dateModified`. Broken schema is worse than none.

`validateJsonLd(value)` is exported from `leadtype/llm` and `leadtype/llm/readability`: a
structural validator (not a full Schema.org validator) that checks `@context`, `@type`, `@id`
references, `url`, ISO dates, and that article-like nodes carry a headline/name — across a
single object or a `@graph`. Returns a list of issues; empty means valid.
