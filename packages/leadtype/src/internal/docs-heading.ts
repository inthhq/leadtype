const DIACRITIC_PATTERN = /[\u0300-\u036f]/g;

function normalizeHeadingText(input: string): string {
  return input.normalize("NFKD").replace(DIACRITIC_PATTERN, "").toLowerCase();
}

export function slugifyDocsHeading(input: string): string {
  return normalizeHeadingText(input)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export type DocsHeadingSlugger = {
  slug: (input: string) => string;
};

/**
 * Page-scoped github-slugger-style counter. `extractDocsTableOfContents` and
 * rendered heading components must share one instance per page so duplicate
 * titles get the same `#slug-N` ids.
 */
export function createDocsHeadingSlugger(): DocsHeadingSlugger {
  const counts = new Map<string, number>();
  return {
    slug(input: string): string {
      const slug = slugifyDocsHeading(input);
      const occurrence = counts.get(slug) ?? 0;
      counts.set(slug, occurrence + 1);
      return occurrence === 0 ? slug : `${slug}-${occurrence}`;
    },
  };
}
