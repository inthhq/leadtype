const DIACRITIC_PATTERN = /[\u0300-\u036f]/g;

function normalizeHeadingText(input: string): string {
  return input.normalize("NFKD").replace(DIACRITIC_PATTERN, "").toLowerCase();
}

export function slugifyDocsHeading(input: string): string {
  return normalizeHeadingText(input)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
