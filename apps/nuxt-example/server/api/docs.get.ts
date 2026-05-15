import { createError, defineEventHandler, getQuery } from "h3";
import { createLoadPageData } from "leadtype/nuxt";
import { getSource } from "../../lib/source";

export default defineEventHandler(async (event) => {
  const source = await getSource();
  const loadPageData = createLoadPageData({ source });
  const query = getQuery(event);
  const slug = typeof query.slug === "string" ? query.slug : "";
  const page = await loadPageData({ slug: slug ? slug.split("/") : [] });
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: "Page not found" });
  }
  return {
    title: page.title,
    urlPath: page.urlPath,
    markdownUrlPath:
      page.urlPath === "/docs" ? "/docs/index.md" : `${page.urlPath}.md`,
    markdown: page.markdown,
  };
});
