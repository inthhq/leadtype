---
"leadtype": patch
---

Cache repeated `<include>` / `<import>` resolution within a conversion run.

`remarkInclude` now accepts an optional include-resolution cache and
`convertAllMdx()` creates one cache per batch run, so pages that reuse the same
partial share the raw file read and parsed markdown AST. Cache keys are scoped
to absolute resolved paths and parser identity, while section anchors such as
`file.mdx#setup` still extract independently from cloned ASTs.

The new `createIncludeResolutionCache()` helper exposes lightweight cache stats
for instrumentation. Current docs and c15t fixtures do not contain repeated
real include nodes, but a synthetic 200-page repeated-include benchmark showed
one raw read, one markdown parse, and roughly a 5.9x speedup in include
expansion time.
