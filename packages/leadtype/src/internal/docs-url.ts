const WINDOWS_PATH_PATTERN = /\\/g;
const INDEX_SEGMENT_PATTERN = /\/index$/;
const ROOT_INDEX_PATTERN = /^index$/;
const MD_EXTENSION_PATTERN = /\.(md|mdx)$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const QUERY_OR_HASH_PATTERN = /[?#]/;

type BrowserGlobal = typeof globalThis & {
  location?: { origin?: string };
  window?: { location?: { origin?: string } };
};

type ProcessGlobal = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

export const GENERIC_DOC_TITLES = new Set(["home", "index", "readme"]);

export function normalizeDocsPath(input: string): string {
  return input.replace(WINDOWS_PATH_PATTERN, "/");
}

export function stripTrailingSlashes(value: string): string {
  return value.replace(TRAILING_SLASHES_PATTERN, "");
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function stripDocsExtension(relativePath: string): string {
  return normalizeDocsPath(relativePath).replace(MD_EXTENSION_PATTERN, "");
}

export function toDocsUrlPath(relativePath: string): string {
  const normalizedPath = stripDocsExtension(relativePath)
    .replace(INDEX_SEGMENT_PATTERN, "")
    .replace(ROOT_INDEX_PATTERN, "");

  return normalizedPath.length > 0 ? `/docs/${normalizedPath}` : "/docs";
}

export function toMarkdownUrlPath(urlPath: string): string {
  return urlPath === "/docs" ? "/docs/index.md" : `${urlPath}.md`;
}

export function toAbsoluteUrl(urlPath: string, baseUrl: string): string {
  if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) {
    return urlPath;
  }
  return `${stripTrailingSlashes(baseUrl)}${urlPath}`;
}

export function normalizeDocsUrl(url: string): string {
  const [withoutHashOrQuery] = url.split(QUERY_OR_HASH_PATTERN, 1);
  const normalized = (withoutHashOrQuery ?? "").replace(
    TRAILING_SLASHES_PATTERN,
    ""
  );

  return normalized.length > 0 ? normalized : "/docs";
}

export function normalizeBaseUrl(baseUrl?: string): string {
  const processEnv = (globalThis as ProcessGlobal).process?.env ?? {};
  const resolved =
    baseUrl?.trim() ||
    processEnv.NEXT_PUBLIC_SITE_URL ||
    (processEnv.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${processEnv.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined) ||
    (processEnv.NEXT_PUBLIC_VERCEL_URL
      ? `https://${processEnv.NEXT_PUBLIC_VERCEL_URL}`
      : undefined) ||
    (processEnv.VERCEL_URL ? `https://${processEnv.VERCEL_URL}` : undefined) ||
    processEnv.PORTLESS_URL ||
    getLocalBaseUrl(processEnv.PORT);

  return stripTrailingSlashes(resolved);
}

function getLocalBaseUrl(portValue?: string): string {
  const browserGlobal = globalThis as BrowserGlobal;
  const browserOrigin =
    browserGlobal.window?.location?.origin ?? browserGlobal.location?.origin;
  if (browserOrigin?.trim()) {
    return browserOrigin.trim();
  }

  const port = portValue?.trim() || "3000";
  return `http://localhost:${port}`;
}
