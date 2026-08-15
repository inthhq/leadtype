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
 *
 * Emitted ids are reserved globally on the page: `Foo`, `Foo`, `Foo-1`
 * becomes `foo`, `foo-1`, `foo-1-1` rather than colliding on `foo-1`.
 */
export function createDocsHeadingSlugger(): DocsHeadingSlugger {
  const nextSuffix = new Map<string, number>();
  const used = new Set<string>();
  return {
    slug(input: string): string {
      const base = slugifyDocsHeading(input);
      let suffix = nextSuffix.get(base) ?? 0;
      let id = suffix === 0 ? base : `${base}-${suffix}`;
      while (used.has(id)) {
        suffix += 1;
        id = `${base}-${suffix}`;
      }
      nextSuffix.set(base, suffix + 1);
      used.add(id);
      return id;
    },
  };
}
