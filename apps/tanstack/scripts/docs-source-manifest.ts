#!/usr/bin/env bun
/**
 * Build-time dogfood of `createDocsSource()` — the v1 source primitive.
 *
 * Writes `src/generated/docs-pages.json` with `{ slug, urlPath, title,
 * description, relativePath, extension }` for every page in `/docs`. The
 * catch-all docs route uses this manifest to wire slugs → MDX modules
 * without hand-rolling one route file per page.
 *
 * The companion `llm-generate.ts` script still emits the on-disk
 * `llms.txt` / `agent-readability.json` artifacts via the older composed
 * APIs. The two paths coexist deliberately — they demonstrate both
 * integration shapes from `/docs/pipeline/build-a-docs-site`.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep as platformSep, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createDocsSource } from "leadtype";
import { normalizeOpenApiConfig, writeOpenApiPages } from "leadtype/openapi";
import docsConfig from "../../../docs/docs.config";

/** `import.meta.glob` keys are always POSIX even on Windows. */
function toPosix(input: string): string {
  return platformSep === "/" ? input : input.replaceAll(platformSep, "/");
}

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const repoRoot = join(appRoot, "..", "..");
const contentDir = join(repoRoot, "docs");
const generatedDir = join(appRoot, "src", "generated");
const manifestPath = join(generatedDir, "docs-pages.json");
const routesDocsDir = join(appRoot, "src", "routes", "docs");
const baseUrl = process.env.BASE_URL?.trim() || "https://leadtype.dev";
// Generated OpenAPI MDX lives inside the app (not the authored /docs tree) so
// Vite's static `import.meta.glob` can compile it. See `pipeline:convert` for
// the markdown-mirror counterpart.
const openapiDocsDir = join(generatedDir, "openapi-docs");

const source = await createDocsSource({
  contentDir,
  baseUrl,
  nav: docsConfig.navigation,
  mounts: docsConfig.mounts,
});

const pages = await source.listPages();

const manifest = pages.map((page) => ({
  slug: page.slug,
  urlPath: page.urlPath,
  title: page.title,
  description: page.description,
  relativePath: page.relativePath,
  extension: page.extension,
  groups: page.groups,
  // Path the runtime catch-all can use to look up the MDX module against
  // `import.meta.glob('../../../../docs/**/*.mdx')`. Always relative to
  // src/routes/docs/$.tsx with POSIX separators so the key matches the
  // glob output on every platform (Windows otherwise emits backslashes).
  globKey: toPosix(
    `${relative(routesDocsDir, join(contentDir, page.relativePath))}${page.extension}`
  ),
}));

// Regenerate OpenAPI reference pages into the app-local generated dir and
// append their manifest entries. `writeOpenApiPages` is deterministic, so this
// stays in sync with the pipeline:convert output for the same spec.
await rm(openapiDocsDir, { force: true, recursive: true });
if (docsConfig.openapi !== undefined) {
  const generated = await writeOpenApiPages({
    configs: normalizeOpenApiConfig(docsConfig.openapi, contentDir, {
      baseUrl,
    }),
    docsDir: openapiDocsDir,
  });
  const MDX_EXTENSION_PATTERN = /\.mdx$/;
  const INDEX_SEGMENT_PATTERN = /(?:^|\/)index$/;
  const generatedEntries = [
    ...generated.pages.map((page) => ({
      description: page.description,
      relativePath: page.relativePath,
      title: page.title,
    })),
    ...generated.indexPages.map((page) => ({
      description: page.description,
      relativePath: page.relativePath,
      title: page.title,
    })),
  ];
  for (const page of generatedEntries) {
    const relativePath = page.relativePath.replace(MDX_EXTENSION_PATTERN, "");
    const urlPath = relativePath.replace(INDEX_SEGMENT_PATTERN, "");
    manifest.push({
      slug: urlPath.split("/").filter(Boolean),
      urlPath: `/docs/${urlPath}`,
      title: page.title,
      description: page.description,
      relativePath,
      extension: ".mdx",
      groups: [],
      globKey: toPosix(
        relative(routesDocsDir, join(openapiDocsDir, page.relativePath))
      ),
    });
  }
}

await mkdir(generatedDir, { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(
  `Wrote ${manifest.length} pages to ${relative(repoRoot, manifestPath)}\n`
);
