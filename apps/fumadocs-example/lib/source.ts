import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loader } from "fumadocs-core/source";
import { fumadocsSource } from "leadtype/fumadocs";
import { normalizeOpenApiConfig, writeOpenApiPages } from "leadtype/openapi";
import docsConfig from "../../../docs/docs.config";

// process.cwd() is the app root when Next runs build/dev.
const repoRoot = resolve(process.cwd(), "..", "..");
const contentDir = resolve(repoRoot, "docs");
const stagedRoot = await mkdtemp(join(tmpdir(), "leadtype-fumadocs-"));
const stagedContentDir = join(stagedRoot, "docs");
await cp(contentDir, stagedContentDir, { recursive: true });

const generatedOpenApi =
  docsConfig.openapi === undefined
    ? { nav: [], pages: [] }
    : await writeOpenApiPages({
        configs: normalizeOpenApiConfig(docsConfig.openapi, contentDir),
        docsDir: stagedContentDir,
      });
const nav = [...(docsConfig.navigation ?? []), ...generatedOpenApi.nav];

/**
 * fumadocs source backed by leadtype/fumadocs. It stages the repo-root
 * Leadtype docs plus generated OpenAPI pages, uses the same curated navigation
 * as the other examples, and resolves `<include>` / `<ExtractedTypeTable>`
 * relative to the repo root.
 */
const fumadocsSourceResult = await fumadocsSource({
  contentDir: stagedContentDir,
  includeMetaJson: false,
  nav,
  mounts: docsConfig.mounts,
  typeTableBasePath: repoRoot,
});

export const source = loader({
  baseUrl: "/docs",
  source: fumadocsSourceResult,
});

/** Underlying leadtype DocsSource — call loadPage/buildSearchIndex/resolveInclude on this. */
export const leadtypeSource = fumadocsSourceResult.leadtype;
