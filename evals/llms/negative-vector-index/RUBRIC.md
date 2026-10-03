# Rubric: default search is not a DB-backed vector index

Task: does Leadtype include a hosted database-backed vector index by default? If not, what does it use by default, and when would embeddings be added?

Ground truth: **No** — Leadtype does **not** ship a hosted/database-backed vector index by default. By default it builds a **static, edge-safe lexical search index** ranked with **BM25** (no database, no network). Embeddings are added **only later**, when users search with vocabulary that doesn't match the docs, or the corpus grows past tens of thousands of chunks — and even then the lexical index is kept for exact matches (embeddings layer on top, they don't replace it).

## REQUIRED — all must be satisfied
- Answers **No** — there is no default database-backed/hosted vector index.
- States the default is a **static / local lexical** index using **BM25** (no database).
- Explains embeddings are an **opt-in later** addition (vocabulary mismatch, or very large corpus), not the default.

## Incorrect if
- Says or implies Leadtype includes a hosted database-backed vector index by default.
- Claims embeddings are on by default, or that they replace the lexical index.
