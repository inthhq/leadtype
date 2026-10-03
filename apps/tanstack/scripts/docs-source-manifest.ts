#!/usr/bin/env bun

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { createDocsProject, type DocsProjectPageMeta } from "leadtype";
import type { AgentReadabilityManifest } from "leadtype/llm/readability";
import { appRoot, baseUrl, generatedDir, repoRoot } from "./docs-project";

const project = await createDocsProject({ cwd: repoRoot, baseUrl });
const pages = await project.listPages();
const routesDocsDir = join(appRoot, "src", "routes", "docs");
const openapiDocsDir = join(generatedDir, "openapi-docs");
await rm(openapiDocsDir, { recursive: true, force: true });

type RenderedPage = Pick<
  DocsProjectPageMeta,
  | "slug"
  | "urlPath"
  | "title"
  | "description"
  | "relativePath"
  | "extension"
  | "groups"
> & { globKey: string };
const manifest: RenderedPage[] = [];
for (const page of pages) {
  let filePath = page.filePath;
  const relativeSource = relative(
    project.getSource(page.collection).contentDir,
    filePath
  );
  if (relativeSource.startsWith(`..${sep}`) || isAbsolute(relativeSource)) {
    // Vite needs generated OpenAPI MDX in a stable directory for its static glob.
    filePath = join(openapiDocsDir, `${page.relativePath}${page.extension}`);
    await mkdir(dirname(filePath), { recursive: true });
    await copyFile(page.filePath, filePath);
  }
  manifest.push({
    slug: page.slug,
    urlPath: page.urlPath,
    title: page.title,
    description: page.description,
    relativePath: page.relativePath,
    extension: page.extension,
    groups: page.groups,
    globKey: relative(routesDocsDir, filePath).split(sep).join("/"),
  });
}

// Fail at build time if the app and generated artifacts ever resolve differently.
const artifacts: AgentReadabilityManifest = JSON.parse(
  await readFile(join(generatedDir, "agent-readability.json"), "utf8")
);
const artifactRoutes = artifacts.pages.map((page) => page.urlPath).sort();
const runtimeRoutes = pages.map((page) => page.urlPath).sort();
if (JSON.stringify(artifactRoutes) !== JSON.stringify(runtimeRoutes)) {
  throw new Error("Rendered docs routes differ from generated agent routes.");
}
const navigation = await project.getNavigation();
// Converted MDX expands components into headings, so page TOCs can differ.
// Compare the sidebar tree, ordering, routes and metadata independently of TOCs.
const withoutToc = (key: string, value: unknown): unknown =>
  key === "toc" ? undefined : value;
if (
  JSON.stringify(artifacts.navigation, withoutToc) !==
  JSON.stringify(navigation, withoutToc)
) {
  throw new Error(
    "Rendered docs navigation differs from generated agent navigation."
  );
}
await writeFile(
  join(generatedDir, "docs-nav.json"),
  `${JSON.stringify(navigation, null, 2)}\n`
);
await writeFile(
  join(generatedDir, "docs-pages.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
process.stdout.write(
  `Wrote ${manifest.length} pages from the resolved docs project.\n`
);
