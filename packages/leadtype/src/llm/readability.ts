import type { AgentReadabilityManifest, AgentReadabilityPage } from "./llm";

export type { AgentReadabilityManifest, AgentReadabilityPage } from "./llm";

const DOCS_DIRNAME = "docs";
const MD_ONLY_EXTENSION_PATTERN = /\.md$/;
const TRAILING_SLASH_PATTERN = /\/$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const MARKDOWN_ACCEPT_PATTERN = /text\/(markdown|plain)/i;
const HTML_ACCEPT_PATTERN = /text\/html/i;
const MARKDOWN_Q_PATTERN = /text\/(markdown|plain)\s*;?\s*q=/i;
const FRONTMATTER_BLOCK_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const YAML_QUOTE_PATTERN = /["\\]/g;
const SCRIPT_JSON_ESCAPE_PATTERN = /[<>&\u2028\u2029]/g;
const QUERY_OR_HASH_PATTERN = /[?#]/;
const ROOT_AGENT_ARTIFACT_PATTERN =
  /^\/(?:llms\.txt|robots\.txt|sitemap\.(?:md|xml))$/;
const DOCS_AGENT_ARTIFACT_PATTERN =
  /^\/docs\/(?:agent-readability\.json|llms(?:-full)?\.txt|llms-full\/.+\.txt|robots\.txt|search-(?:content|index)\.json|sitemap\.(?:md|xml))$/;
const AI_USER_AGENT_PATTERN =
  /\b(anthropic-ai|claude-web|claudebot|ccbot|chatgpt-user|gptbot|google-extended|oai-searchbot|perplexitybot)\b/i;

export type JsonLdValue = Record<string, unknown>;

export type MarkdownMirrorTarget = {
  /** Canonical HTML route, e.g. `/docs/quickstart`. */
  urlPath: string;
  /** Markdown mirror route, e.g. `/docs/quickstart.md`. */
  markdownUrlPath: string;
  /** Path under a generated output directory, e.g. `docs/quickstart.md`. */
  filePath: string;
  /** Relative document key without extension, e.g. `quickstart`. */
  relativePath: string;
};

export type AgentRequestHeaders = Record<string, string | string[] | undefined>;

export type MarkdownResponseHeadersConfig = {
  canonicalUrl: string;
  includeUserAgentVary?: boolean;
};

export type EnrichMarkdownFrontmatterConfig = {
  canonicalUrl: string;
  lastUpdated?: string | Date;
};

export type RenderMissingMarkdownConfig = {
  urlPath: string;
  canonicalUrl: string;
  lastUpdated?: string | Date;
};

export type AgentMarkdownResponse = {
  status: 200;
  headers: Record<string, string>;
  body: string;
  found: boolean;
  target?: MarkdownMirrorTarget;
};

export type CreateAgentMarkdownResponseConfig = {
  urlPath: string;
  method?: string;
  headers?: AgentRequestHeaders;
  manifest: AgentReadabilityManifest;
  readMarkdownFile: (target: MarkdownMirrorTarget) => string | null | undefined;
  requestOrigin?: string;
  now?: Date;
};

function normalizeDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(TRAILING_SLASHES_PATTERN, "");
}

function toAbsoluteUrl(urlPath: string, baseUrl: string): string {
  if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) {
    return urlPath;
  }
  return `${baseUrl}${urlPath}`;
}

function normalizeUrlPath(input: string): string {
  try {
    const pathname = new URL(input, "http://leadtype.local").pathname;
    return pathname.startsWith("/") ? pathname : `/${pathname}`;
  } catch {
    const [pathname = "/"] = input.split(QUERY_OR_HASH_PATTERN, 1);
    return pathname.startsWith("/") ? pathname : `/${pathname}`;
  }
}

function toYamlScalar(value: string): string {
  return `"${value.replace(YAML_QUOTE_PATTERN, "\\$&")}"`;
}

function frontmatterHasField(frontmatter: string, names: string[]): boolean {
  return names.some((name) =>
    new RegExp(`^${name}\\s*:`, "m").test(frontmatter)
  );
}

function readFrontmatterField(
  frontmatter: string,
  names: string[]
): string | null {
  for (const name of names) {
    const match = frontmatter.match(
      new RegExp(`^${name}\\s*:\\s*['"]?([^'"\\n]+)['"]?\\s*$`, "m")
    );
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function getHeaderValue(
  headers: AgentRequestHeaders | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return;
  }
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) {
      continue;
    }
    return Array.isArray(value) ? value.join(",") : value;
  }
  return;
}

function readableMethod(method: string | undefined): boolean {
  return method === undefined || method === "GET" || method === "HEAD";
}

function jsonScriptEscape(value: string): string {
  return value.replace(SCRIPT_JSON_ESCAPE_PATTERN, (character) => {
    switch (character) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return character;
    }
  });
}

function jsonLdPageDescription(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): string {
  return (
    page.description ||
    `${page.title} documentation for ${manifest.product.name}.`
  );
}

export function isAgentUserAgent(userAgent: string | undefined): boolean {
  return Boolean(userAgent && AI_USER_AGENT_PATTERN.test(userAgent));
}

export function acceptsMarkdownHeader(accept: string | undefined): boolean {
  if (!(accept && MARKDOWN_ACCEPT_PATTERN.test(accept))) {
    return false;
  }
  return !(
    HTML_ACCEPT_PATTERN.test(accept) && !MARKDOWN_Q_PATTERN.test(accept)
  );
}

export function isAgentReadabilityArtifactPath(urlPath: string): boolean {
  const pathname = normalizeUrlPath(urlPath);
  return (
    ROOT_AGENT_ARTIFACT_PATTERN.test(pathname) ||
    DOCS_AGENT_ARTIFACT_PATTERN.test(pathname)
  );
}

export function resolveMarkdownMirrorTarget(
  urlPath: string
): MarkdownMirrorTarget | null {
  const pathname = normalizeUrlPath(urlPath).replace(
    TRAILING_SLASH_PATTERN,
    ""
  );

  if (isAgentReadabilityArtifactPath(pathname)) {
    return null;
  }

  if (
    pathname === "/docs" ||
    pathname === "/docs.md" ||
    pathname === "/docs/index.md"
  ) {
    return {
      urlPath: "/docs",
      markdownUrlPath: "/docs/index.md",
      filePath: `${DOCS_DIRNAME}/index.md`,
      relativePath: "index",
    };
  }

  if (!pathname.startsWith("/docs/")) {
    return null;
  }

  const withoutExtension = pathname.replace(MD_ONLY_EXTENSION_PATTERN, "");
  const relativePath = withoutExtension.slice("/docs/".length);
  if (!(relativePath && !relativePath.split("/").includes(".."))) {
    return null;
  }

  return {
    urlPath: withoutExtension,
    markdownUrlPath: `${withoutExtension}.md`,
    filePath: `${DOCS_DIRNAME}/${relativePath}.md`,
    relativePath,
  };
}

export function createMarkdownResponseHeaders(
  config: MarkdownResponseHeadersConfig
): Record<string, string> {
  return {
    "Content-Type": "text/markdown; charset=utf-8",
    Vary: config.includeUserAgentVary ? "Accept, User-Agent" : "Accept",
    Link: `<${config.canonicalUrl}>; rel="canonical"`,
  };
}

export function enrichMarkdownFrontmatter(
  markdown: string,
  config: EnrichMarkdownFrontmatterConfig
): string {
  const match = markdown.match(FRONTMATTER_BLOCK_PATTERN);
  if (!match) {
    return markdown;
  }

  const frontmatter = match[1] ?? "";
  const aliases: string[] = [];

  if (!frontmatterHasField(frontmatter, ["canonical_url", "canonical"])) {
    aliases.push(`canonical_url: ${toYamlScalar(config.canonicalUrl)}`);
  }

  if (!frontmatterHasField(frontmatter, ["last_updated", "lastmod", "date"])) {
    const lastUpdated =
      normalizeDate(config.lastUpdated) ??
      readFrontmatterField(frontmatter, [
        "lastModified",
        "lastUpdated",
        "last_modified",
      ]) ??
      new Date().toISOString();
    aliases.push(`last_updated: ${toYamlScalar(lastUpdated)}`);
  }

  if (aliases.length === 0) {
    return markdown;
  }

  const body = markdown.slice(match[0].length);
  return `---\n${frontmatter.trimEnd()}\n${aliases.join("\n")}\n---\n${body}`;
}

export function renderMissingMarkdown(
  config: RenderMissingMarkdownConfig
): string {
  const lastUpdated =
    normalizeDate(config.lastUpdated) ?? new Date().toISOString();
  return `---
title: "Page not found"
description: ${toYamlScalar(`No documentation page exists at ${config.urlPath}.`)}
canonical_url: ${toYamlScalar(config.canonicalUrl)}
last_updated: ${toYamlScalar(lastUpdated)}
---
# Page not found

No documentation page exists at \`${config.urlPath}\`.

Use [/llms.txt](/llms.txt) or [/sitemap.md](/sitemap.md) to find available pages.
`;
}

export function renderJsonLd(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): JsonLdValue {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.title,
    description: jsonLdPageDescription(page, manifest),
    url: page.absoluteUrl,
    dateModified: page.lastModified,
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Docs",
          item: `${manifest.baseUrl}/docs`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: page.title,
          item: page.absoluteUrl,
        },
      ],
    },
  };
}

export function renderJsonLdScript(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): string {
  const json = jsonScriptEscape(JSON.stringify(renderJsonLd(page, manifest)));
  return `<script type="application/ld+json">${json}</script>`;
}

export function createAgentMarkdownResponse(
  config: CreateAgentMarkdownResponseConfig
): AgentMarkdownResponse | null {
  const pathname = normalizeUrlPath(config.urlPath);
  if (!readableMethod(config.method)) {
    return null;
  }

  const accept = getHeaderValue(config.headers, "accept");
  const userAgent = getHeaderValue(config.headers, "user-agent");
  const wantsMarkdown =
    acceptsMarkdownHeader(accept) || isAgentUserAgent(userAgent);
  const target = resolveMarkdownMirrorTarget(pathname);

  if (target && (wantsMarkdown || pathname.endsWith(".md"))) {
    const page = config.manifest.pages.find(
      (entry) => entry.urlPath === target.urlPath
    );
    const canonicalUrl =
      page?.absoluteUrl ??
      toAbsoluteUrl(target.urlPath, config.manifest.baseUrl);
    const markdown = config.readMarkdownFile(target);
    const body = markdown
      ? enrichMarkdownFrontmatter(markdown, {
          canonicalUrl,
          lastUpdated: page?.lastModified,
        })
      : renderMissingMarkdown({
          urlPath: target.urlPath,
          canonicalUrl,
          lastUpdated: config.now,
        });
    return {
      status: 200,
      headers: createMarkdownResponseHeaders({
        canonicalUrl,
        includeUserAgentVary: isAgentUserAgent(userAgent),
      }),
      body: config.method === "HEAD" ? "" : body,
      found: Boolean(markdown),
      target,
    };
  }

  if (wantsMarkdown && !isAgentReadabilityArtifactPath(pathname)) {
    const canonicalUrl = toAbsoluteUrl(
      pathname,
      config.requestOrigin
        ? normalizeBaseUrl(config.requestOrigin)
        : config.manifest.baseUrl
    );
    return {
      status: 200,
      headers: createMarkdownResponseHeaders({
        canonicalUrl,
        includeUserAgentVary: isAgentUserAgent(userAgent),
      }),
      body:
        config.method === "HEAD"
          ? ""
          : renderMissingMarkdown({
              urlPath: pathname,
              canonicalUrl,
              lastUpdated: config.now,
            }),
      found: false,
    };
  }

  return null;
}
