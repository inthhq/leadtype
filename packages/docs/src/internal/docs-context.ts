import path from "node:path";

const WINDOWS_PATH_PATTERN = /\\/g;
const INDEX_SEGMENT_PATTERN = /\/index$/;
const ROOT_INDEX_PATTERN = /^index$/;
const MD_EXTENSION_PATTERN = /\.(md|mdx)$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const PLACEHOLDER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)(?::([^}]+))?\}/g;

const FRAMEWORK_PATH_PATTERNS = [
  /\/docs\/frameworks\/([^/]+)(?:\/|$)/,
  /\/docs\/shared\/([^/]+)(?:\/|$)/,
] as const;
const KNOWN_FRAMEWORKS = new Set(["javascript", "next", "react"]);

export type DocContext = {
  framework: string | null;
  frameworkDocsBase: string | null;
  sourcePath: string;
};

function normalizePath(input: string): string {
  return input.replace(WINDOWS_PATH_PATTERN, "/");
}

export function deriveDocContext(sourcePath: string): DocContext {
  const normalizedPath = normalizePath(sourcePath);

  for (const pattern of FRAMEWORK_PATH_PATTERNS) {
    const match = normalizedPath.match(pattern);
    const framework = match?.[1] ?? null;
    if (framework && KNOWN_FRAMEWORKS.has(framework)) {
      return {
        framework,
        frameworkDocsBase: `/docs/frameworks/${framework}`,
        sourcePath,
      };
    }
  }

  return {
    framework: null,
    frameworkDocsBase: null,
    sourcePath,
  };
}

function resolvePlaceholderValue(
  key: string,
  context: DocContext
): string | null {
  if (key === "framework") {
    return context.framework;
  }
  if (key === "frameworkDocsBase") {
    return context.frameworkDocsBase;
  }
  return null;
}

export function hasDocPlaceholder(input: string): boolean {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return PLACEHOLDER_PATTERN.test(input);
}

export function resolveDocPlaceholders(
  input: string,
  context: DocContext
): { unresolved: string[]; value: string } {
  const unresolved = new Set<string>();

  const value = input.replace(
    PLACEHOLDER_PATTERN,
    (match: string, key: string, fallback?: string): string => {
      const resolved = resolvePlaceholderValue(key, context);
      if (resolved !== null) {
        return resolved;
      }
      if (fallback !== undefined) {
        return fallback;
      }
      unresolved.add(match);
      return match;
    }
  );

  return {
    value,
    unresolved: Array.from(unresolved),
  };
}

export function resolvePlaceholderStrings<T>(value: T, context: DocContext): T {
  if (typeof value === "string") {
    return resolveDocPlaceholders(value, context).value as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolvePlaceholderStrings(item, context)) as T;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(([key, entryValue]) => [
      key,
      resolvePlaceholderStrings(entryValue, context),
    ]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

export function toDocsUrlPath(relativePath: string): string {
  const normalizedPath = normalizePath(relativePath)
    .replace(MD_EXTENSION_PATTERN, "")
    .replace(INDEX_SEGMENT_PATTERN, "")
    .replace(ROOT_INDEX_PATTERN, "");

  return normalizedPath.length > 0 ? `/docs/${normalizedPath}` : "/docs";
}

export function normalizeDocsUrl(url: string): string {
  const [withoutHashOrQuery] = url.split(/[?#]/, 1);
  const normalized = (withoutHashOrQuery ?? "").replace(
    TRAILING_SLASHES_PATTERN,
    ""
  );

  return normalized.length > 0 ? normalized : "/docs";
}

export function routeFromFilePath(srcDir: string, filePath: string): string {
  const relativePath = normalizePath(path.relative(srcDir, filePath));
  return toDocsUrlPath(relativePath);
}
