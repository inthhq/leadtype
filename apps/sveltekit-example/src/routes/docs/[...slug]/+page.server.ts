import { error } from "@sveltejs/kit";
import { createEntries, createLoadPageData } from "leadtype/sveltekit";
import { source } from "$lib/source";
import type { PageServerLoad } from "./$types";

export const entries = createEntries({ source });
export const prerender = true;

const loadPageData = createLoadPageData({ source });

export const load: PageServerLoad = async (event) => {
  const page = await loadPageData(event);
  if (!page) {
    throw error(404, "Page not found");
  }
  return {
    page: {
      title: page.title,
      urlPath: page.urlPath,
      markdownUrlPath:
        page.urlPath === "/docs" ? "/docs/index.md" : `${page.urlPath}.md`,
      markdown: page.markdown,
    },
  };
};
