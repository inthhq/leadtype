import { basename, dirname, resolve } from "node:path";
import { normalizeDocsUrl } from "../internal/docs-context";
import type { DocsConfig } from "../llm/llm";
import { resolveDocsNavigation } from "../llm/llm";
import type { LintViolation } from "./runner";

/**
 * Lint the links the docs config itself owns. A dead link in curated
 * navigation or `llms.sections` fails the same way one in a page does —
 * previously these bypassed lint entirely and only surfaced when
 * `leadtype generate` blew up (or worse, shipped).
 */
export type ConfigLintOptions = {
  config: DocsConfig;
  /** Reported as the violation `file` — usually the config path relative to cwd. */
  configFile: string;
  /** Docs source directory the config's pages resolve against. */
  srcDir: string;
  /** Route set for the docs tree, mounts applied. */
  routeSet: ReadonlySet<string>;
  /** Link prefixes assumed valid (generated trees like the OpenAPI output). */
  assumeValidLinkPrefixes?: readonly string[];
};

function isAssumedValid(
  url: string,
  prefixes: readonly string[] | undefined
): boolean {
  return (prefixes ?? []).some(
    (prefix) => url === prefix || url.startsWith(`${prefix}/`)
  );
}

export async function lintConfigLinks(
  options: ConfigLintOptions
): Promise<LintViolation[]> {
  const { config, configFile, srcDir, routeSet } = options;
  const violations: LintViolation[] = [];
  const pushViolation = (
    severity: LintViolation["severity"],
    field: string,
    message: string
  ): void => {
    violations.push({
      file: configFile,
      kind: "config",
      severity,
      rule: "config-link",
      field,
      message,
    });
  };

  // Curated navigation: resolve it exactly like generate does, so a renamed
  // page referenced by name fails lint instead of the later generate run.
  if (config.navigation || config.groups) {
    try {
      // resolveDocsNavigation expects the *parent* of the docs tree plus the
      // tree's directory name (it joins them internally), while lint's
      // `srcDir` is the docs tree itself.
      const resolvedSrcDir = resolve(srcDir);
      const navigation = await resolveDocsNavigation({
        srcDir: dirname(resolvedSrcDir),
        docsDirName: basename(resolvedSrcDir),
        groups: config.groups,
        nav: config.navigation,
        mounts: config.mounts,
        i18n: config.i18n,
      });
      for (const unknown of navigation.unknown) {
        pushViolation(
          "error",
          "navigation",
          `${unknown.urlPath} declares unknown group \`${unknown.slug}\``
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushViolation("error", "navigation", message);
    }
  }

  // Curated llms.txt links.
  for (const [index, section] of (config.llms?.sections ?? []).entries()) {
    if (section.type !== "links") {
      continue;
    }
    for (const link of section.links) {
      const normalized = normalizeDocsUrl(link.urlPath);
      if (
        routeSet.has(normalized) ||
        isAssumedValid(normalized, options.assumeValidLinkPrefixes)
      ) {
        continue;
      }
      pushViolation(
        "error",
        `llms.sections[${index}]`,
        `links to missing docs route \`${normalized}\``
      );
    }
  }

  // Feed source prefixes: a feed matching zero pages generates empty output
  // and warns at generate time — catch the typo here instead.
  for (const [index, feed] of (config.feeds ?? []).entries()) {
    const prefix = normalizeDocsUrl(feed.source.urlPrefix);
    const matchesAny =
      prefix === "/" ||
      [...routeSet].some(
        (route) => route === prefix || route.startsWith(`${prefix}/`)
      );
    if (!matchesAny) {
      pushViolation(
        "warn",
        `feeds[${index}]`,
        `feed \`${feed.id}\` selects by \`${feed.source.urlPrefix}\`, which matches no docs route`
      );
    }
  }

  // Acknowledged removals that are live again: the redirect step ignores
  // them, so the stale config entry is pure confusion — flag it.
  for (const removed of config.redirects?.removed ?? []) {
    const normalized = normalizeDocsUrl(removed);
    if (routeSet.has(normalized)) {
      pushViolation(
        "warn",
        "redirects.removed",
        `\`${normalized}\` is listed as removed but a live page exists at that route`
      );
    }
  }

  return violations;
}
