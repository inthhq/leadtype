/**
 * Runtime-side primitives for the Vercel Agent Readability spec. Build-time
 * generation lives in `./llm`; this module is the entry point for any
 * framework's request middleware. It is fs-free, edge-runtime safe, and
 * returns Web `Response` objects so it works in Node, Bun, Vercel Edge,
 * Cloudflare Workers, Hono, Astro, Nuxt, Vite middleware, etc.
 */

const DOCS_DIRNAME = "docs";
const MD_ONLY_EXTENSION_PATTERN = /\.md$/;
const TRAILING_SLASH_PATTERN = /\/$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const MARKDOWN_ACCEPT_PATTERN = /text\/(markdown|plain)/i;
const HTML_ACCEPT_PATTERN = /text\/html/i;
const FRONTMATTER_BLOCK_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const YAML_QUOTE_PATTERN = /["\\]/g;
const SCRIPT_JSON_ESCAPE_PATTERN = /[<>&\u2028\u2029]/g;
const QUERY_OR_HASH_PATTERN = /[?#]/;
const ROOT_AGENT_ARTIFACT_PATTERN =
  /^\/(?:llms(?:-full)?\.txt|robots\.txt|sitemap\.(?:md|xml))$/;
const DOCS_AGENT_ARTIFACT_PATTERN =
  /^\/docs\/(?:agent-readability\.json|llms(?:-full)?\.txt|llms-full\/.+\.txt|robots\.txt|search-(?:content|index)\.json|sitemap\.(?:md|xml))$/;
const AI_USER_AGENT_PATTERN =
  /\b(amazonbot|anthropic-ai|applebot|bingbot|bytespider|ccbot|chatgpt-user|claude-web|claudebot|google-extended|gptbot|metaexternalagent|meta-externalagent|mistralbot|oai-searchbot|perplexitybot|youbot)\b/i;
const DEFAULT_AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "AmazonBot",
  "Bingbot",
  "MetaExternalAgent",
  "ByteSpider",
  "PerplexityBot",
  "MistralBot",
  "AppleBot",
  "YouBot",
] as const;
const DEFAULT_CACHE_CONTROL = "public, max-age=300, must-revalidate";
const SUPPORTED_MANIFEST_VERSION = 1;
const XML_ESCAPE_PATTERN = /[<>&'"]/g;

export type JsonLdValue = Record<string, unknown>;

export type AgentReadabilityPage = {
  title: string;
  description: string;
  urlPath: string;
  absoluteUrl: string;
  markdownUrlPath: string;
  markdownAbsoluteUrl: string;
  relativePath: string;
  groups: string[];
  lastModified: string;
};

export type DocsNavigationPage = {
  urlPath: string;
  title: string;
  description: string;
  /** All group slugs the page declared (normalized). */
  groups: string[];
};

export type DocsNavigationGroup = {
  slug: string;
  segmentPath: string[];
  title: string;
  description?: string;
  pages: DocsNavigationPage[];
  children: DocsNavigationGroup[];
};

export type DocsNavigation = {
  groups: DocsNavigationGroup[];
  ungrouped: DocsNavigationPage[];
  /** Pages that named a group slug not present in the config. */
  unknown: { urlPath: string; slug: string }[];
};

export type AgentReadabilityManifest = {
  version: 1;
  generatedAt: string;
  baseUrl: string;
  product: { name: string; summary: string };
  pages: AgentReadabilityPage[];
  navigation: DocsNavigation;
  files: {
    robotsTxt: string;
    sitemapMd: string;
    sitemapXml: string;
  };
};

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
  /** Override Cache-Control. Pass `null` to omit the header. */
  cacheControl?: string | null;
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

export type CreateAgentMarkdownResponseConfig = {
  urlPath: string;
  method?: string;
  headers?: AgentRequestHeaders;
  manifest: AgentReadabilityManifest;
  readMarkdownFile: (
    target: MarkdownMirrorTarget
  ) => string | null | undefined | Promise<string | null | undefined>;
  requestOrigin?: string;
  now?: Date;
  /** Override the default AI user-agent regex. */
  userAgentPattern?: RegExp;
  /** Override Cache-Control. Pass `null` to omit. */
  cacheControl?: string | null;
};

export type AgentArtifactResponseConfig = {
  manifest: AgentReadabilityManifest;
  /** Live request origin, e.g. "http://localhost:5173". Falls back to manifest.baseUrl. */
  requestOrigin?: string;
  /** Optional: merge non-docs pages into the sitemap. Defaults to manifest.pages. */
  pages?: AgentReadabilityPage[];
  /** Override Cache-Control. Pass `null` to omit. */
  cacheControl?: string | null;
};

export type CreateSitemapMarkdownResponseConfig =
  AgentArtifactResponseConfig & {
    /** Optional override for the navigation tree. Defaults to manifest.navigation. */
    navigation?: DocsNavigation;
    /** Override product name displayed in the heading. Defaults to manifest.product.name. */
    productName?: string;
  };

export type CreateRobotsTxtResponseConfig = {
  manifest?: AgentReadabilityManifest;
  /** Live request origin. Falls back to manifest.baseUrl when manifest is provided. */
  requestOrigin?: string;
  /** Path of the sitemap relative to origin. Default: "/sitemap.xml". */
  sitemapUrlPath?: string;
  /** Allow paths under the User-agent directives. */
  allowPaths?: string[];
  /** Override the AI crawler User-agent list. */
  userAgents?: readonly string[];
  /** Override Cache-Control. Pass `null` to omit. */
  cacheControl?: string | null;
};

export type DocsHeadEntry = Record<string, unknown>;

export type DocsHead = {
  meta: DocsHeadEntry[];
  links: DocsHeadEntry[];
};

export type CreateDocsHeadConfig = {
  urlPath: string;
  manifest: AgentReadabilityManifest;
  /** Key under which the JSON-LD payload is embedded in `meta`. Default: "script:ld+json" (TanStack Router). */
  jsonLdMetaKey?: string;
};

export type RenderSitemapMarkdownConfig = {
  product: { name: string };
  navigation: DocsNavigation;
  pages: AgentReadabilityPage[];
};

export type RenderRobotsTxtConfig = {
  baseUrl?: string;
  sitemapUrlPath?: string;
  allowPaths?: string[];
  userAgents?: readonly string[];
};

/* ----------------------- internal helpers ------------------------------ */

function assertManifestVersion(manifest: { version: number }): void {
  if (manifest.version !== SUPPORTED_MANIFEST_VERSION) {
    throw new Error(
      `leadtype: agent-readability manifest version ${manifest.version} is not supported (expected ${SUPPORTED_MANIFEST_VERSION}). Regenerate the manifest with the matching leadtype version.`
    );
  }
}

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

function stripTrailingSlashes(value: string): string {
  return value.replace(TRAILING_SLASHES_PATTERN, "");
}

function toAbsoluteUrl(urlPath: string, baseUrl: string): string {
  if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) {
    return urlPath;
  }
  return `${stripTrailingSlashes(baseUrl)}${urlPath}`;
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
    // Match through end of line, tolerating either LF or CRLF terminators.
    const match = frontmatter.match(
      new RegExp(`^${name}\\s*:\\s*['"]?([^'"\\r\\n]+)['"]?\\s*$`, "m")
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
      case " ":
        return "\\u2028";
      case " ":
        return "\\u2029";
      default:
        return character;
    }
  });
}

function escapeXml(value: string): string {
  return value.replace(XML_ESCAPE_PATTERN, (character) => {
    switch (character) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
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

/**
 * Parse the q-value of a single `Accept`-header media-type segment.
 * Defaults to 1 when no `q=` parameter is present.
 */
function parseQValue(segment: string): number {
  const match = segment.match(/;\s*q\s*=\s*(\d(?:\.\d+)?)/i);
  if (!match?.[1]) {
    return 1;
  }
  const parsed = Number.parseFloat(match[1]);
  if (Number.isNaN(parsed)) {
    return 1;
  }
  return Math.min(1, Math.max(0, parsed));
}

function effectiveAcceptQValues(accept: string): {
  markdown: number;
  html: number;
} {
  let markdown = 0;
  let html = 0;
  for (const rawSegment of accept.split(",")) {
    const segment = rawSegment.trim();
    if (!segment) {
      continue;
    }
    const q = parseQValue(segment);
    if (MARKDOWN_ACCEPT_PATTERN.test(segment) && q > markdown) {
      markdown = q;
    }
    if (HTML_ACCEPT_PATTERN.test(segment) && q > html) {
      html = q;
    }
  }
  return { markdown, html };
}

/* ----------------------- public predicates ----------------------------- */

export function isAgentUserAgent(
  userAgent: string | undefined,
  pattern: RegExp = AI_USER_AGENT_PATTERN
): boolean {
  return Boolean(userAgent && pattern.test(userAgent));
}

/**
 * Detect whether a request prefers markdown over HTML.
 *
 * The bias is intentional: when an Accept header contains both `text/html` and
 * `text/markdown` with no q-values, browsers (which always send `text/html` in
 * the list) get HTML and explicit agents that include markdown still win when
 * they set `q=` lower for HTML. To force markdown for an agent that lists html
 * implicitly, prefer the AI user-agent path or pass `Accept: text/markdown`.
 */
export function acceptsMarkdownHeader(accept: string | undefined): boolean {
  if (!accept) {
    return false;
  }
  const { markdown, html } = effectiveAcceptQValues(accept);
  if (markdown <= 0) {
    return false;
  }
  if (html <= 0) {
    return true;
  }
  return markdown > html;
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

/* ----------------------- markdown response builders -------------------- */

export function createMarkdownResponseHeaders(
  config: MarkdownResponseHeadersConfig
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "text/markdown; charset=utf-8",
    Vary: config.includeUserAgentVary ? "Accept, User-Agent" : "Accept",
    Link: `<${config.canonicalUrl}>; rel="canonical"`,
  };
  const cacheControl =
    config.cacheControl === undefined
      ? DEFAULT_CACHE_CONTROL
      : config.cacheControl;
  if (cacheControl !== null) {
    headers["Cache-Control"] = cacheControl;
  }
  return headers;
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

/* ----------------------- JSON-LD helpers ------------------------------- */

export function renderJsonLd(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): JsonLdValue {
  assertManifestVersion(manifest);
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

/* ----------------------- markdown content negotiation ------------------ */

export async function createAgentMarkdownResponse(
  config: CreateAgentMarkdownResponseConfig
): Promise<Response | null> {
  assertManifestVersion(config.manifest);

  const pathname = normalizeUrlPath(config.urlPath);
  if (!readableMethod(config.method)) {
    return null;
  }

  const accept = getHeaderValue(config.headers, "accept");
  const userAgent = getHeaderValue(config.headers, "user-agent");
  const matchesAgentUa = isAgentUserAgent(userAgent, config.userAgentPattern);
  const wantsMarkdown = acceptsMarkdownHeader(accept) || matchesAgentUa;
  const target = resolveMarkdownMirrorTarget(pathname);
  const isHead = config.method === "HEAD";

  if (target && (wantsMarkdown || pathname.endsWith(".md"))) {
    const page = config.manifest.pages.find(
      (entry) => entry.urlPath === target.urlPath
    );
    const canonicalUrl =
      page?.absoluteUrl ??
      toAbsoluteUrl(target.urlPath, config.manifest.baseUrl);
    const markdown = await config.readMarkdownFile(target);
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
    return new Response(isHead ? null : body, {
      status: 200,
      headers: createMarkdownResponseHeaders({
        canonicalUrl,
        includeUserAgentVary: matchesAgentUa,
        cacheControl: config.cacheControl,
      }),
    });
  }

  if (wantsMarkdown && !isAgentReadabilityArtifactPath(pathname)) {
    const canonicalUrl = toAbsoluteUrl(
      pathname,
      config.requestOrigin
        ? stripTrailingSlashes(config.requestOrigin)
        : config.manifest.baseUrl
    );
    return new Response(
      isHead
        ? null
        : renderMissingMarkdown({
            urlPath: pathname,
            canonicalUrl,
            lastUpdated: config.now,
          }),
      {
        status: 200,
        headers: createMarkdownResponseHeaders({
          canonicalUrl,
          includeUserAgentVary: matchesAgentUa,
          cacheControl: config.cacheControl,
        }),
      }
    );
  }

  return null;
}

/* ----------------------- pure renderers (sitemap/robots) --------------- */

export function renderSitemapXml(pages: AgentReadabilityPage[]): string {
  const urls = pages
    .map(
      (page) => `  <url>
    <loc>${escapeXml(page.absoluteUrl)}</loc>
    <lastmod>${escapeXml(page.lastModified)}</lastmod>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function renderSitemapGroup(
  group: DocsNavigationGroup,
  pagesByPath: Map<string, AgentReadabilityPage>,
  depth = 2
): string[] {
  const lines = [`${"#".repeat(depth)} ${group.title}`];
  if (group.description) {
    lines.push("", group.description);
  }

  const links: string[] = [];
  for (const page of group.pages) {
    const readablePage = pagesByPath.get(page.urlPath);
    if (!readablePage) {
      continue;
    }
    const description = readablePage.description
      ? `: ${readablePage.description}`
      : "";
    links.push(
      `- [${readablePage.title}](${readablePage.urlPath})${description}`
    );
  }

  if (links.length > 0) {
    lines.push("", ...links);
  }

  for (const child of group.children) {
    lines.push("", ...renderSitemapGroup(child, pagesByPath, depth + 1));
  }

  return lines;
}

export function renderSitemapMarkdown(
  config: RenderSitemapMarkdownConfig
): string {
  const pagesByPath = new Map(config.pages.map((page) => [page.urlPath, page]));
  const lines = [
    "# Sitemap",
    "",
    `Structured documentation sitemap for ${config.product.name}.`,
  ];

  for (const group of config.navigation.groups) {
    lines.push("", ...renderSitemapGroup(group, pagesByPath));
  }

  if (config.navigation.ungrouped.length > 0) {
    lines.push("", "## Other", "");
    for (const page of config.navigation.ungrouped) {
      const readablePage = pagesByPath.get(page.urlPath);
      if (!readablePage) {
        continue;
      }
      const description = readablePage.description
        ? `: ${readablePage.description}`
        : "";
      lines.push(
        `- [${readablePage.title}](${readablePage.urlPath})${description}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderRobotsTxt(config: RenderRobotsTxtConfig): string {
  const baseUrl = stripTrailingSlashes(config.baseUrl ?? "");
  const sitemapPath = config.sitemapUrlPath ?? "/sitemap.xml";
  const sitemapUrl = baseUrl ? `${baseUrl}${sitemapPath}` : sitemapPath;
  const allowPaths = config.allowPaths ?? [
    "/",
    "/docs/",
    "/llms.txt",
    "/docs/llms.txt",
    "/sitemap.xml",
    "/sitemap.md",
  ];
  const userAgents = config.userAgents ?? DEFAULT_AI_CRAWLER_USER_AGENTS;
  const lines = ["User-agent: *"];
  for (const allowPath of allowPaths) {
    lines.push(`Allow: ${allowPath}`);
  }
  lines.push("");

  for (const userAgent of userAgents) {
    lines.push(`User-agent: ${userAgent}`);
    for (const allowPath of allowPaths) {
      lines.push(`Allow: ${allowPath}`);
    }
    lines.push("");
  }

  lines.push(`Sitemap: ${sitemapUrl}`, "");
  return lines.join("\n");
}

/* ----------------------- runtime regenerator helpers ------------------- */

function rebasePage(
  page: AgentReadabilityPage,
  fromBase: string,
  toBase: string
): AgentReadabilityPage {
  if (fromBase === toBase) {
    return page;
  }
  const swap = (value: string): string =>
    value.startsWith(fromBase)
      ? `${toBase}${value.slice(fromBase.length)}`
      : value;
  return {
    ...page,
    absoluteUrl: swap(page.absoluteUrl),
    markdownAbsoluteUrl: swap(page.markdownAbsoluteUrl),
  };
}

function attachCacheControl(
  headers: Record<string, string>,
  cacheControl: string | null | undefined
): Record<string, string> {
  const value =
    cacheControl === undefined ? DEFAULT_CACHE_CONTROL : cacheControl;
  if (value === null) {
    return headers;
  }
  return { ...headers, "Cache-Control": value };
}

function resolveEffectiveBase(
  manifest: AgentReadabilityManifest,
  requestOrigin: string | undefined
): string {
  return requestOrigin
    ? stripTrailingSlashes(requestOrigin)
    : stripTrailingSlashes(manifest.baseUrl);
}

export function createSitemapXmlResponse(
  config: AgentArtifactResponseConfig
): Response {
  assertManifestVersion(config.manifest);
  const fromBase = stripTrailingSlashes(config.manifest.baseUrl);
  const toBase = resolveEffectiveBase(config.manifest, config.requestOrigin);
  const sourcePages = config.pages ?? config.manifest.pages;
  const rebased = sourcePages.map((page) => rebasePage(page, fromBase, toBase));
  return new Response(renderSitemapXml(rebased), {
    status: 200,
    headers: attachCacheControl(
      {
        "Content-Type": "application/xml; charset=utf-8",
      },
      config.cacheControl
    ),
  });
}

export function createSitemapMarkdownResponse(
  config: CreateSitemapMarkdownResponseConfig
): Response {
  assertManifestVersion(config.manifest);
  const fromBase = stripTrailingSlashes(config.manifest.baseUrl);
  const toBase = resolveEffectiveBase(config.manifest, config.requestOrigin);
  const sourcePages = config.pages ?? config.manifest.pages;
  const rebased = sourcePages.map((page) => rebasePage(page, fromBase, toBase));
  return new Response(
    renderSitemapMarkdown({
      product: { name: config.productName ?? config.manifest.product.name },
      navigation: config.navigation ?? config.manifest.navigation,
      pages: rebased,
    }),
    {
      status: 200,
      headers: attachCacheControl(
        {
          "Content-Type": "text/markdown; charset=utf-8",
        },
        config.cacheControl
      ),
    }
  );
}

export function createRobotsTxtResponse(
  config: CreateRobotsTxtResponseConfig
): Response {
  if (config.manifest) {
    assertManifestVersion(config.manifest);
  }
  let baseUrl = "";
  if (config.manifest) {
    baseUrl = resolveEffectiveBase(config.manifest, config.requestOrigin);
  } else if (config.requestOrigin) {
    baseUrl = stripTrailingSlashes(config.requestOrigin);
  }
  return new Response(
    renderRobotsTxt({
      baseUrl,
      sitemapUrlPath: config.sitemapUrlPath,
      allowPaths: config.allowPaths,
      userAgents: config.userAgents,
    }),
    {
      status: 200,
      headers: attachCacheControl(
        { "Content-Type": "text/plain; charset=utf-8" },
        config.cacheControl
      ),
    }
  );
}

/* ----------------------- head metadata helper -------------------------- */

const DEFAULT_JSON_LD_META_KEY = "script:ld+json";

function pageTitle(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): string {
  return `${page.title} | ${manifest.product.name}`;
}

function pageDescription(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): string {
  return (
    page.description ||
    `${page.title} documentation for ${manifest.product.name}.`
  );
}

/**
 * Build the head metadata for a docs page from the agent-readability manifest.
 * Returns a framework-neutral `{ meta, links }` shape: `meta` entries are
 * objects suitable for TanStack Router / Next.js Metadata-style head APIs;
 * `links` entries are link descriptors (canonical + alternate text/markdown).
 *
 * If the page is not present in the manifest, both arrays are empty so the
 * caller can fall back to its own metadata.
 */
export function createDocsHead(config: CreateDocsHeadConfig): DocsHead {
  assertManifestVersion(config.manifest);
  const page = config.manifest.pages.find(
    (entry) => entry.urlPath === config.urlPath
  );
  if (!page) {
    return { meta: [], links: [] };
  }

  const title = pageTitle(page, config.manifest);
  const description = pageDescription(page, config.manifest);
  const jsonLdKey = config.jsonLdMetaKey ?? DEFAULT_JSON_LD_META_KEY;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { [jsonLdKey]: renderJsonLd(page, config.manifest) },
    ],
    links: [
      { rel: "canonical", href: page.absoluteUrl },
      {
        rel: "alternate",
        type: "text/markdown",
        href: page.markdownAbsoluteUrl,
      },
    ],
  };
}
