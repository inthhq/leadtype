import { error } from "@sveltejs/kit";
import { loadDocsPageData } from "$lib/docs-page-data";
import { manifest } from "$lib/manifest";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;

export const entries: EntryGenerator = () =>
  manifest.pages
    .filter(
      (page) => page.urlPath === "/docs" || page.urlPath.startsWith("/docs/")
    )
    .map((page) => ({
      slug: page.urlPath === "/docs" ? "" : page.urlPath.slice("/docs/".length),
    }));

export const load: PageServerLoad = async ({ params }) => {
  const slug = params.slug ?? "";
  const urlPath = slug ? `/docs/${slug}` : "/docs";
  const pageData = await loadDocsPageData(urlPath);
  if (!pageData) {
    throw error(404, "Page not found");
  }
  return pageData;
};
