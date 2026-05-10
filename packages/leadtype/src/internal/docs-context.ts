import path from "node:path";
import { normalizeDocsPath, toDocsUrlPath } from "./docs-url";

export { normalizeDocsUrl, toDocsUrlPath } from "./docs-url";

const PLACEHOLDER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)(?::([^}]+))?\}/g;

const FRAMEWORK_PATH_PATTERNS = [
  /\/docs\/frameworks\/([^/]+)(?:\/|$)/,
] as const;

export type DocContext = {
  framework: string | null;
  frameworkDocsBase: string | null;
  sourcePath: string;
};

/**
 * Build placeholder context from a docs source path.
 *
 * Framework routes are derived from the path itself so callers do not need to
 * maintain a fixed allowlist of framework slugs.
 */
export function deriveDocContext(sourcePath: string): DocContext {
  const normalizedPath = normalizeDocsPath(sourcePath);

  for (const pattern of FRAMEWORK_PATH_PATTERNS) {
    const match = normalizedPath.match(pattern);
    const framework = match?.[1] ?? null;
    if (framework) {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, entryValue]) => [
      key,
      resolvePlaceholderStrings(entryValue, context),
    ]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

export function routeFromFilePath(srcDir: string, filePath: string): string {
  const relativePath = normalizeDocsPath(path.relative(srcDir, filePath));
  return toDocsUrlPath(relativePath);
}
