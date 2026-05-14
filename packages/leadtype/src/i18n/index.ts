import {
  type DocsPathMount,
  normalizeDocsPath,
  normalizeUrlPrefix,
  stripDocsExtension,
  toDocsUrlPath,
} from "../internal/docs-url";

const LOCALE_CODE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const MARKDOWN_EXTENSION_PATTERN = /\.(md|mdx)$/;

export type LocaleCode = string;

export type DocsLocale = {
  code: LocaleCode;
  label?: string;
  dir?: "ltr" | "rtl";
};

export type DocsLocaleInput = LocaleCode | DocsLocale;

export type DocsI18nConfig = {
  defaultLocale: LocaleCode;
  locales: DocsLocaleInput[];
  fallback?: "default";
};

export type NormalizedDocsI18nConfig = {
  defaultLocale: LocaleCode;
  locales: DocsLocale[];
  fallback: "default";
};

export type LocalizedDocsMetadata = {
  locale?: LocaleCode;
  sourceLocale?: LocaleCode;
  isFallback?: boolean;
  logicalPath?: string;
};

export type DocsLocaleArtifactPaths = {
  locale: LocaleCode;
  urlPrefix: string;
  llmsTxt?: string;
  llmsFullTxt?: string;
  searchIndex?: string;
  searchContent?: string;
  agentReadabilityManifest?: string;
  robotsTxt?: string;
  sitemapMd?: string;
  sitemapXml?: string;
};

export type DocsI18nManifest = {
  version: 1;
  defaultLocale: LocaleCode;
  locales: DocsLocale[];
  artifacts: DocsLocaleArtifactPaths[];
};

export type AlternateLocaleLink = {
  locale: LocaleCode;
  urlPath: string;
  label?: string;
  dir?: "ltr" | "rtl";
  isFallback: boolean;
};

export type LocalizedPageLike = {
  locale?: LocaleCode;
  sourceLocale?: LocaleCode;
  isFallback?: boolean;
  logicalPath?: string;
  urlPath: string;
};

function assertValidLocaleCode(code: string): LocaleCode {
  if (!LOCALE_CODE_PATTERN.test(code)) {
    throw new Error(
      `Invalid locale code "${code}". Locale codes must be URL-safe and may contain letters, numbers, underscores, or dashes.`
    );
  }
  return code;
}

function normalizeLocale(input: DocsLocaleInput): DocsLocale {
  if (typeof input === "string") {
    return { code: assertValidLocaleCode(input) };
  }
  return {
    ...input,
    code: assertValidLocaleCode(input.code),
  };
}

export function normalizeDocsI18nConfig(
  config?: DocsI18nConfig
): NormalizedDocsI18nConfig | undefined {
  if (!config) {
    return;
  }

  const defaultLocale = assertValidLocaleCode(config.defaultLocale);
  const seen = new Set<string>();
  const locales: DocsLocale[] = [];

  for (const localeInput of config.locales) {
    const locale = normalizeLocale(localeInput);
    const key = locale.code.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate locale code "${locale.code}" in i18n config.`);
    }
    seen.add(key);
    locales.push(locale);
  }

  if (!seen.has(defaultLocale.toLowerCase())) {
    throw new Error(
      `i18n.defaultLocale "${defaultLocale}" must be included in i18n.locales.`
    );
  }

  return {
    defaultLocale,
    locales,
    fallback: config.fallback ?? "default",
  };
}

export function listDocsLocales(i18n?: DocsI18nConfig): DocsLocale[] {
  return normalizeDocsI18nConfig(i18n)?.locales ?? [];
}

export function isDefaultLocale(
  locale: LocaleCode,
  i18n?: DocsI18nConfig
): boolean {
  return normalizeDocsI18nConfig(i18n)?.defaultLocale === locale;
}

export function getDocsLocaleUrlPrefix(
  locale: LocaleCode,
  i18n?: DocsI18nConfig,
  docsUrlPrefix = "/docs"
): string {
  const normalized = normalizeDocsI18nConfig(i18n);
  const prefix = normalizeUrlPrefix(docsUrlPrefix);
  if (!normalized || locale === normalized.defaultLocale) {
    return prefix;
  }
  return `${prefix}/${locale}`;
}

function splitUrlPath(pathname: string): string[] {
  return normalizeDocsPath(pathname)
    .split("/")
    .filter((segment) => segment.length > 0);
}

export function resolveDocsLocale(
  pathname: string,
  i18n?: DocsI18nConfig,
  docsUrlPrefix = "/docs"
): LocaleCode | undefined {
  const normalized = normalizeDocsI18nConfig(i18n);
  if (!normalized) {
    return;
  }

  const prefixSegments = splitUrlPath(docsUrlPrefix);
  const pathnameSegments = splitUrlPath(pathname);
  const isUnderDocsPrefix = prefixSegments.every(
    (segment, index) => pathnameSegments[index] === segment
  );
  if (!isUnderDocsPrefix) {
    return;
  }

  const afterPrefix = pathnameSegments.slice(prefixSegments.length);
  const first = afterPrefix[0];
  const matched = normalized.locales.find((locale) => locale.code === first);
  return matched?.code ?? normalized.defaultLocale;
}

export function stripLocaleFromDocsPath(
  pathname: string,
  i18n?: DocsI18nConfig,
  docsUrlPrefix = "/docs"
): string {
  const normalized = normalizeDocsI18nConfig(i18n);
  if (!normalized) {
    return pathname;
  }

  const prefix = normalizeUrlPrefix(docsUrlPrefix);
  const segments = splitUrlPath(pathname);
  const prefixSegments = splitUrlPath(prefix);
  const localeCodes = new Set(normalized.locales.map((locale) => locale.code));

  if (
    prefixSegments.every((segment, index) => segments[index] === segment) &&
    localeCodes.has(segments[prefixSegments.length] ?? "")
  ) {
    const stripped = [
      ...prefixSegments,
      ...segments.slice(prefixSegments.length + 1),
    ];
    return `/${stripped.join("/")}`;
  }

  return pathname;
}

export function toLocalizedDocsUrlPath(
  relativePath: string,
  locale: LocaleCode,
  i18n?: DocsI18nConfig,
  mounts?: DocsPathMount[]
): string {
  const basePath = toDocsUrlPath(relativePath, mounts);
  const normalized = normalizeDocsI18nConfig(i18n);
  if (!normalized || locale === normalized.defaultLocale) {
    return basePath;
  }

  const matchedMount = [...(mounts ?? [{ pathPrefix: "", urlPrefix: "/docs" }])]
    .map((mount) => normalizeUrlPrefix(mount.urlPrefix))
    .sort((left, right) => right.length - left.length)
    .find(
      (urlPrefix) =>
        basePath === urlPrefix || basePath.startsWith(`${urlPrefix}/`)
    );
  const urlPrefix = matchedMount ?? "/docs";
  const suffix = basePath === urlPrefix ? "" : basePath.slice(urlPrefix.length);
  return `${urlPrefix}/${locale}${suffix}`;
}

export function toLocalizedMarkdownUrlPath(
  relativePath: string,
  locale: LocaleCode,
  i18n?: DocsI18nConfig,
  mounts?: DocsPathMount[]
): string {
  const logicalPath = stripDocsExtension(relativePath);
  const urlPath = toLocalizedDocsUrlPath(
    `${logicalPath}.md`,
    locale,
    i18n,
    mounts
  );
  return logicalPath === "index" || logicalPath.endsWith("/index")
    ? `${urlPath}/index.md`
    : `${urlPath}.md`;
}

export function logicalPathFromLocaleRelativePath(
  relativePath: string,
  localeCodes: Set<string>
): { logicalPath: string; sourceLocale?: LocaleCode } {
  const normalized = normalizeDocsPath(relativePath);
  const segments = normalized.split("/");
  const first = segments[0] ?? "";
  if (localeCodes.has(first)) {
    return {
      logicalPath: stripDocsExtension(segments.slice(1).join("/")),
      sourceLocale: first,
    };
  }
  return {
    logicalPath: stripDocsExtension(normalized),
  };
}

export function outputRelativePathForLocale(
  logicalPath: string,
  locale: LocaleCode,
  i18n?: DocsI18nConfig
): string {
  const normalized = normalizeDocsI18nConfig(i18n);
  if (!normalized || locale === normalized.defaultLocale) {
    return logicalPath.replace(MARKDOWN_EXTENSION_PATTERN, "");
  }
  return `${locale}/${logicalPath.replace(MARKDOWN_EXTENSION_PATTERN, "")}`;
}

export function getAlternateLocaleLinks(
  page: LocalizedPageLike,
  pagesByLocale: Map<LocaleCode, LocalizedPageLike>,
  i18n?: DocsI18nConfig
): AlternateLocaleLink[] {
  const normalized = normalizeDocsI18nConfig(i18n);
  if (!normalized) {
    return [];
  }

  return normalized.locales.flatMap((locale) => {
    const alternate = pagesByLocale.get(locale.code);
    if (!alternate) {
      return [];
    }
    if (
      page.logicalPath &&
      alternate.logicalPath &&
      page.logicalPath !== alternate.logicalPath
    ) {
      return [];
    }
    return [
      {
        locale: locale.code,
        urlPath: alternate.urlPath,
        isFallback: alternate.sourceLocale !== locale.code,
        ...(locale.label ? { label: locale.label } : {}),
        ...(locale.dir ? { dir: locale.dir } : {}),
      },
    ];
  });
}
