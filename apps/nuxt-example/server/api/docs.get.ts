import { readFile } from "node:fs/promises";
import path from "node:path";
import { createError, defineEventHandler } from "h3";
import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createDocsNavigation } from "leadtype/navigation";
import manifestJson from "../../public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);
const nav = createDocsNavigation(manifest.navigation);
const CONTENT_DIR = path.resolve(process.cwd(), "public/docs");
const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;

function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_PATTERN, "");
}

export default defineEventHandler(async (event) => {
  const requestUrl = new URL(event.node?.req.url ?? "/", "http://localhost");
  const slug = requestUrl.searchParams.get("slug") ?? "";
  const prefix = requestUrl.searchParams.get("prefix") ?? "/docs";
  if (!(prefix === "/docs" || prefix === "/changelog")) {
    throw createError({ statusCode: 400, statusMessage: "Invalid prefix" });
  }
  const urlPath = slug ? `${prefix}/${slug}` : prefix;
  const page = manifest.pages.find((entry) => entry.urlPath === urlPath);
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: "Page not found" });
  }
  const markdown = await readFile(
    path.join(CONTENT_DIR, `${page.relativePath}.md`),
    "utf8"
  );
  return {
    description: page.description,
    title: page.title,
    urlPath: page.urlPath,
    markdownUrlPath:
      page.urlPath === "/docs" ? "/docs/index.md" : `${page.urlPath}.md`,
    mdc: stripFrontmatter(markdown),
    toc: nav.findPage(page.urlPath)?.toc ?? [],
  };
});
