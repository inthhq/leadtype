import { describe, expect, it } from "vitest";
import {
  getAlternateLocaleLinks,
  getDocsLocaleUrlPrefix,
  isDefaultLocale,
  listDocsLocales,
  logicalPathFromLocaleRelativePath,
  normalizeDocsI18nConfig,
  outputRelativePathForLocale,
  resolveDocsLocale,
  stripLocaleFromDocsPath,
  toLocalizedDocsUrlPath,
  toLocalizedMarkdownUrlPath,
} from "./index";

const i18n = {
  defaultLocale: "en",
  locales: ["en", "zh", { code: "fr", label: "Français" }],
} as const;

describe("i18n helpers", () => {
  it("normalizes shorthand and object locale entries", () => {
    expect(normalizeDocsI18nConfig(i18n)).toMatchObject({
      defaultLocale: "en",
      fallback: "default",
      locales: [
        { code: "en" },
        { code: "zh" },
        { code: "fr", label: "Français" },
      ],
    });
  });

  it("validates locale config mistakes", () => {
    expect(() =>
      normalizeDocsI18nConfig({ defaultLocale: "en", locales: ["en", "en"] })
    ).toThrow(/Duplicate locale code/);
    expect(() =>
      normalizeDocsI18nConfig({ defaultLocale: "en", locales: ["zh"] })
    ).toThrow(/must be included/);
    expect(() =>
      normalizeDocsI18nConfig({ defaultLocale: "en", locales: ["../en"] })
    ).toThrow(/Invalid locale code/);
  });

  it("returns empty locale lists when i18n is disabled", () => {
    expect(normalizeDocsI18nConfig()).toBeUndefined();
    expect(listDocsLocales()).toEqual([]);
    expect(resolveDocsLocale("/docs/quickstart")).toBeUndefined();
    expect(stripLocaleFromDocsPath("/docs/zh/quickstart")).toBe(
      "/docs/zh/quickstart"
    );
    expect(
      getAlternateLocaleLinks(
        { urlPath: "/docs/quickstart" },
        new Map([["en", { urlPath: "/docs/quickstart" }]])
      )
    ).toEqual([]);
  });

  it("keeps default docs unprefixed and prefixes translated locales", () => {
    expect(toLocalizedDocsUrlPath("quickstart.mdx", "en", i18n)).toBe(
      "/docs/quickstart"
    );
    expect(toLocalizedDocsUrlPath("quickstart.mdx", "zh", i18n)).toBe(
      "/docs/zh/quickstart"
    );
    expect(toLocalizedMarkdownUrlPath("guides/index.md", "zh", i18n)).toBe(
      "/docs/zh/guides/index.md"
    );
    expect(
      toLocalizedDocsUrlPath("v1.mdx", "zh", i18n, [
        { pathPrefix: "changelog", urlPrefix: "/changelog" },
        { pathPrefix: "", urlPrefix: "/docs" },
      ])
    ).toBe("/docs/zh/v1");
    expect(
      toLocalizedDocsUrlPath("changelog/v1.mdx", "zh", i18n, [
        { pathPrefix: "changelog", urlPrefix: "/changelog" },
        { pathPrefix: "", urlPrefix: "/docs" },
      ])
    ).toBe("/changelog/zh/v1");
  });

  it("exposes locale prefix helpers", () => {
    expect(isDefaultLocale("en", i18n)).toBe(true);
    expect(isDefaultLocale("zh", i18n)).toBe(false);
    expect(getDocsLocaleUrlPrefix("en", i18n)).toBe("/docs");
    expect(getDocsLocaleUrlPrefix("zh", i18n)).toBe("/docs/zh");
    expect(getDocsLocaleUrlPrefix("zh", i18n, "/reference")).toBe(
      "/reference/zh"
    );
  });

  it("resolves and strips locale prefixes from docs URLs", () => {
    expect(resolveDocsLocale("/docs/quickstart", i18n)).toBe("en");
    expect(resolveDocsLocale("/docs/zh/quickstart", i18n)).toBe("zh");
    expect(stripLocaleFromDocsPath("/docs/zh/quickstart", i18n)).toBe(
      "/docs/quickstart"
    );
    expect(stripLocaleFromDocsPath("/docs/quickstart", i18n)).toBe(
      "/docs/quickstart"
    );
    expect(resolveDocsLocale("/reference/fr/intro", i18n, "/reference")).toBe(
      "fr"
    );
  });

  it("derives logical paths and output paths from locale folders", () => {
    const localeCodes = new Set(["en", "zh"]);
    expect(
      logicalPathFromLocaleRelativePath("zh/guides/setup.mdx", localeCodes)
    ).toEqual({
      logicalPath: "guides/setup",
      sourceLocale: "zh",
    });
    expect(
      logicalPathFromLocaleRelativePath("guides/setup.mdx", localeCodes)
    ).toEqual({
      logicalPath: "guides/setup",
    });
    expect(outputRelativePathForLocale("guides/setup.mdx", "en", i18n)).toBe(
      "guides/setup"
    );
    expect(outputRelativePathForLocale("guides/setup.mdx", "zh", i18n)).toBe(
      "zh/guides/setup"
    );
  });

  it("returns alternate locale links from localized page maps", () => {
    const alternates = getAlternateLocaleLinks(
      { urlPath: "/docs/quickstart", logicalPath: "quickstart" },
      new Map([
        ["en", { urlPath: "/docs/quickstart", sourceLocale: "en" }],
        ["zh", { urlPath: "/docs/zh/quickstart", sourceLocale: "en" }],
      ]),
      i18n
    );

    expect(alternates).toEqual([
      {
        locale: "en",
        urlPath: "/docs/quickstart",
        isFallback: false,
      },
      {
        locale: "zh",
        urlPath: "/docs/zh/quickstart",
        isFallback: true,
      },
    ]);
  });

  it("filters alternate links by logical path when available", () => {
    const alternates = getAlternateLocaleLinks(
      { urlPath: "/docs/quickstart", logicalPath: "quickstart" },
      new Map([
        [
          "en",
          {
            urlPath: "/docs/other",
            logicalPath: "other",
            sourceLocale: "en",
          },
        ],
      ]),
      i18n
    );

    expect(alternates).toEqual([]);
  });
});
