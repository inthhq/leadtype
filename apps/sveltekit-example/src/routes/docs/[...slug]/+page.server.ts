import { readFile } from "node:fs/promises";
import path from "node:path";
import { error } from "@sveltejs/kit";
import type { DocsTableOfContentsItem } from "leadtype/llm/readability";
import { manifest, nav, pageForUrlPath } from "$lib/manifest";
import { renderMarkdown } from "$lib/markdown";
import type { EntryGenerator, PageServerLoad } from "./$types";

const CONTENT_DIR = path.resolve(process.cwd(), "static/docs");

export const prerender = true;

export const entries: EntryGenerator = () =>
  manifest.pages.map((page) => ({
    slug: page.urlPath === "/docs" ? "" : page.urlPath.slice("/docs/".length),
  }));

function flattenTocIds(items: readonly DocsTableOfContentsItem[]): string[] {
  return items.flatMap((item) => [item.id, ...flattenTocIds(item.children)]);
}

export const load: PageServerLoad = async ({ params }) => {
  const slug = params.slug ?? "";
  const urlPath = slug ? `/docs/${slug}` : "/docs";
  const page = pageForUrlPath(urlPath);
  if (!page) {
    throw error(404, "Page not found");
  }

  const markdown = await readFile(
    path.join(CONTENT_DIR, `${page.relativePath}.md`),
    "utf8"
  );
  const toc = nav.findPage(urlPath)?.toc ?? [];

  return {
    html: await renderMarkdown(markdown, { headingIds: flattenTocIds(toc) }),
    markdownUrlPath: urlPath === "/docs" ? "/docs/index.md" : `${urlPath}.md`,
    title: page.title,
    toc,
    urlPath,
  };
};
