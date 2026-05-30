import { error } from "@sveltejs/kit";
import {
  createDocsJsonLd,
  normalizeAgentReadabilityManifest,
  stringifyJsonLd,
} from "leadtype/llm/readability";
import { createEntries, createLoadPageData } from "leadtype/sveltekit";
import { source } from "$lib/source";
import manifestJson from "../../../../static/docs/agent-readability.json";
import type { PageServerLoad } from "./$types";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

export const entries = createEntries({ source });
export const prerender = true;

const loadPageData = createLoadPageData({ source });

export const load: PageServerLoad = async (event) => {
  const page = await loadPageData(event);
  if (!page) {
    throw error(404, "Page not found");
  }
  const meta = manifest.pages.find((entry) => entry.urlPath === page.urlPath);
  const jsonLd = createDocsJsonLd({ urlPath: page.urlPath, manifest });
  return {
    page: {
      title: page.title,
      urlPath: page.urlPath,
      markdownUrlPath:
        page.urlPath === "/docs" ? "/docs/index.md" : `${page.urlPath}.md`,
      markdown: page.markdown,
      canonicalUrl: meta?.absoluteUrl ?? null,
      markdownAbsoluteUrl: meta?.markdownAbsoluteUrl ?? null,
      jsonLdScript: jsonLd
        ? `<script type="application/ld+json">${stringifyJsonLd(jsonLd)}</script>`
        : null,
    },
  };
};
