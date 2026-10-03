import { error } from "@sveltejs/kit";
import { loadDocsPageData } from "$lib/docs-page-data";
import { manifest } from "$lib/manifest";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;

export const entries: EntryGenerator = () =>
  manifest.pages
    .filter((page) => page.urlPath.startsWith("/changelog/"))
    .map((page) => ({
      slug: page.urlPath.slice("/changelog/".length),
    }));

export const load: PageServerLoad = async ({ params }) => {
  const pageData = await loadDocsPageData(`/changelog/${params.slug}`);
  if (!pageData) {
    throw error(404, "Page not found");
  }
  return pageData;
};
