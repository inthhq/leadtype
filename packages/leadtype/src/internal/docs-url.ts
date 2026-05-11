const WINDOWS_PATH_PATTERN = /\\/g;
const INDEX_SEGMENT_PATTERN = /\/index$/;
const ROOT_INDEX_PATTERN = /^index$/;
const MD_EXTENSION_PATTERN = /\.(md|mdx)$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const QUERY_OR_HASH_PATTERN = /[?#]/;
const LEADING_SLASHES_PATTERN = /^\/+/;

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

export type DocsPathMount = {
  pathPrefix: string;
  urlPrefix: string;
};

export function normalizeUrlPrefix(input: string): string {
  const normalized = `/${normalizeDocsPath(input).replace(LEADING_SLASHES_PATTERN, "")}`;
  return stripTrailingSlashes(normalized) || "/";
}

function stripIndexSegments(relativePath: string): string {
  return stripDocsExtension(relativePath)
    .replace(INDEX_SEGMENT_PATTERN, "")
    .replace(ROOT_INDEX_PATTERN, "");
}

function normalizeMountPathPrefix(input: string): string {
  return stripTrailingSlashes(normalizeDocsPath(input)).replace(
    LEADING_SLASHES_PATTERN,
    ""
  );
}

function resolveDocsPathMount(
  relativePath: string,
  mounts: DocsPathMount[] | undefined
): { mount: DocsPathMount; mountedRelativePath: string } {
  const normalizedPath = normalizeDocsPath(relativePath);
  const normalizedMounts = (
    mounts && mounts.length > 0
      ? mounts
      : [{ pathPrefix: "", urlPrefix: "/docs" }]
  )
    .map((mount) => ({
      pathPrefix: normalizeMountPathPrefix(mount.pathPrefix),
      urlPrefix: normalizeUrlPrefix(mount.urlPrefix),
    }))
    .sort((left, right) => right.pathPrefix.length - left.pathPrefix.length);

  for (const mount of normalizedMounts) {
    if (!mount.pathPrefix) {
      return { mount, mountedRelativePath: normalizedPath };
    }
    if (
      normalizedPath === mount.pathPrefix ||
      normalizedPath.startsWith(`${mount.pathPrefix}/`)
    ) {
      return {
        mount,
        mountedRelativePath: normalizedPath.slice(mount.pathPrefix.length + 1),
      };
    }
  }

  return {
    mount: { pathPrefix: "", urlPrefix: "/docs" },
    mountedRelativePath: normalizedPath,
  };
}

export function toDocsUrlPath(
  relativePath: string,
  mounts?: DocsPathMount[]
): string {
  const { mount, mountedRelativePath } = resolveDocsPathMount(
    relativePath,
    mounts
  );
  const normalizedPath = stripIndexSegments(mountedRelativePath);
  const urlPrefix = normalizeUrlPrefix(mount.urlPrefix);

  return normalizedPath.length > 0
    ? `${urlPrefix}/${normalizedPath}`
    : urlPrefix;
}

export function toMarkdownUrlPath(urlPath: string): string {
  return urlPath === "/docs" ? "/docs/index.md" : `${urlPath}.md`;
}

export function toMountedMarkdownUrlPath(
  relativePath: string,
  mounts?: DocsPathMount[]
): string {
  const urlPath = toDocsUrlPath(relativePath, mounts);
  const stripped = stripIndexSegments(
    resolveDocsPathMount(relativePath, mounts).mountedRelativePath
  );
  return stripped.length > 0 ? `${urlPath}.md` : `${urlPath}/index.md`;
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
