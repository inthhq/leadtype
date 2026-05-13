import { resolve } from "node:path";
import { loader } from "fumadocs-core/source";
import { fumadocsSource } from "leadtype/fumadocs";

// process.cwd() is the app root when Next runs build/dev.
const contentDir = resolve(
  process.cwd(),
  "..",
  "..",
  ".docs-src",
  "c15t",
  "docs"
);

/**
 * fumadocs source backed by leadtype/fumadocs. Walks `.docs-src/c15t/docs`,
 * picks up both `.mdx` pages and the c15t-authored `meta.json` files, and
 * resolves `<include>` / `<ExtractedTypeTable>` at build time via
 * `mdxSourcePlugins` (wired in `next.config.mjs`).
 */
const fumadocsSourceResult = await fumadocsSource({ contentDir });

export const source = loader({
  baseUrl: "/docs",
  source: fumadocsSourceResult,
});

/** Underlying leadtype DocsSource — call loadPage/buildSearchIndex/resolveInclude on this. */
export const leadtypeSource = fumadocsSourceResult.leadtype;
