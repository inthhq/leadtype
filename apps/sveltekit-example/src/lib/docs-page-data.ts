import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DocsTableOfContentsItem } from "leadtype/llm/readability";
import { nav, pageForUrlPath } from "$lib/manifest";
import { renderMarkdown } from "$lib/markdown";

const CONTENT_DIR = path.resolve(process.cwd(), "static/docs");

function flattenTocIds(items: readonly DocsTableOfContentsItem[]): string[] {
  return items.flatMap((item) => [item.id, ...flattenTocIds(item.children)]);
}

export async function loadDocsPageData(urlPath: string) {
  const page = pageForUrlPath(urlPath);
  if (!page) {
    return null;
  }

  const markdown = await readFile(
    path.join(CONTENT_DIR, `${page.relativePath}.md`),
    "utf8"
  );
  const toc = nav.findPage(urlPath)?.toc ?? [];

  return {
    description: page.description,
    html: await renderMarkdown(markdown, { headingIds: flattenTocIds(toc) }),
    markdownUrlPath: page.markdownUrlPath,
    title: page.title,
    toc,
    urlPath,
  };
}
