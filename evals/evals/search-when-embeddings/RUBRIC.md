# Rubric: default search and when embeddings are warranted

Task: what does leadtype's search use by default, and when is adding embeddings actually warranted (and what to keep even then)?

Ground truth: by default leadtype builds a **static, edge-safe lexical search index ranked with BM25** — no database, no network, no embeddings. So a hosted vector DB is unnecessary by default. Embeddings are warranted **only** when (a) users search with **vocabulary that doesn't match the docs** (e.g. "make it faster" → a "performance" page), or (b) the corpus grows **past tens of thousands of chunks** and cold-start memory becomes an issue. Even then, **keep the lexical index for exact matches** — embeddings layer on top (complementary), they don't replace it.

## REQUIRED — all must be satisfied
- Default is a **static / local lexical** index using **BM25** — no database (the proposed hosted vector DB isn't needed by default).
- Gives the **specific** conditions for adding embeddings: vocabulary/intent mismatch with the docs, **and/or** a very large corpus (≈ tens of thousands of chunks). A generic "add embeddings for better search" is not enough.
- States the lexical index is **kept** for exact matches — embeddings are complementary, not a replacement.

## Incorrect if
- Claims leadtype ships or needs a vector database by default.
- Says embeddings should replace the lexical index.
- Gives only the default without the specific when-to-add-embeddings conditions.
