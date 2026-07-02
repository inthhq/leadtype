import { resolve } from "node:path";
import { loader } from "fumadocs-core/source";
import { fumadocsSource } from "leadtype/fumadocs";
import docsConfig from "../../../docs/docs.config";

// process.cwd() is the app root when Next runs build/dev.
const repoRoot = resolve(process.cwd(), "..", "..");
const contentDir = resolve(repoRoot, "docs");

/**
 * fumadocs source backed by leadtype/fumadocs. It reads the repo-root
 * Leadtype docs, uses the same curated navigation as the other examples, and
 * resolves `<include>` / `<ExtractedTypeTable>` relative to the repo root.
 *
 * Passing `openapi` stages generated API reference pages into a temp copy of
 * the docs and appends their navigation — the authored docs are untouched.
 */
const fumadocsSourceResult = await fumadocsSource({
  contentDir,
  includeMetaJson: false,
  nav: docsConfig.navigation,
  mounts: docsConfig.mounts,
  openapi: docsConfig.openapi,
  typeTableBasePath: repoRoot,
});

export const source = loader({
  baseUrl: "/docs",
  source: fumadocsSourceResult,
});

/** Underlying leadtype DocsSource — call loadPage/buildSearchIndex/resolveInclude on this. */
export const leadtypeSource = fumadocsSourceResult.leadtype;
