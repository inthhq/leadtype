import { resolve } from "node:path";
import { loader } from "fumadocs-core/source";
import { createDocsProject } from "leadtype";
import { fumadocsSource } from "leadtype/fumadocs";
import docsConfig from "../../../docs/docs.config";

// process.cwd() is the app root when Next runs build/dev.
const repoRoot = resolve(process.cwd(), "..", "..");

/**
 * The project resolves the repo-root docs from the config: content root,
 * curated navigation, mounts, and the OpenAPI overlay all come from
 * `docs/docs.config.ts` rather than being restated here, so this app and the
 * generated agent artifacts describe the same docs.
 */
const project = await createDocsProject({
  config: docsConfig,
  configPath: resolve(repoRoot, "docs", "docs.config.ts"),
  typeTableBasePath: repoRoot,
});

// The adapter takes the project directly — a project satisfies `DocsSource`.
const fumadocsSourceResult = await fumadocsSource({
  source: project,
  includeMetaJson: false,
});

export const source = loader({
  baseUrl: "/docs",
  source: fumadocsSourceResult,
});

/** Underlying leadtype source — call loadPage/buildSearchIndex/resolveInclude on this. */
export const leadtypeSource = fumadocsSourceResult.leadtype;
