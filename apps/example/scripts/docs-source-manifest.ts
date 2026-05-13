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
 * integration shapes from `/docs/build/build-a-docs-site`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createDocsSource } from "leadtype";
import docsConfig from "../../../docs/docs.config";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const repoRoot = join(appRoot, "..", "..");
const contentDir = join(repoRoot, "docs");
const generatedDir = join(appRoot, "src", "generated");
const manifestPath = join(generatedDir, "docs-pages.json");

const source = await createDocsSource({
  contentDir,
  baseUrl: process.env.BASE_URL?.trim() || "https://leadtype.dev",
  groups: docsConfig.groups,
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
  // src/routes/docs/$.tsx so the glob key matches exactly.
  globKey: `${relative(join(appRoot, "src", "routes", "docs"), join(contentDir, page.relativePath))}${page.extension}`,
}));

await mkdir(generatedDir, { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(
  `Wrote ${manifest.length} pages to ${relative(repoRoot, manifestPath)}\n`
);
