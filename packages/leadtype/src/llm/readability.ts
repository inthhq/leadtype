/**
 * Runtime-side primitives for the Vercel Agent Readability spec. Build-time
 * generation lives in `./llm`; this module is the entry point for any
 * framework's request middleware. It is fs-free, edge-runtime safe, and
 * returns Web `Response` objects so it works in Node, Bun, Vercel Edge,
 * Cloudflare Workers, Hono, Astro, Nuxt, Vite middleware, etc.
 */

import type { DocsI18nManifest, LocalizedDocsMetadata } from "../i18n";
import {
  normalizeDocsPath,
  stripTrailingSlashes,
  toAbsoluteUrl,
} from "../internal/docs-url";
import { isAsciiMediaType } from "../internal/media-type";
import { hasUnpairedUtf16Surrogate } from "../internal/unicode";
import { type DocsRedirect, resolveRedirect } from "../redirects/redirects";

export { slugifyDocsHeading } from "../internal/docs-heading";

const DOCS_DIRNAME = "docs";
const MD_ONLY_EXTENSION_PATTERN = /\.md$/;
const TRAILING_SLASH_PATTERN = /\/$/;
const MARKDOWN_ACCEPT_PATTERN = /text\/(markdown|plain)/i;
const HTML_ACCEPT_PATTERN = /text\/html/i;
const FRONTMATTER_BLOCK_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const QUOTED_STRING_ESCAPE_PATTERN = /["\\]/g;
const ASCII_CONTROL_MAX_CODE_POINT = 0x1f;
const ASCII_DELETE_CODE_POINT = 0x7f;
const INVALID_PERCENT_ESCAPE_PATTERN = /%(?![0-9a-f]{2})/i;
const VALID_PERCENT_ESCAPE_PATTERN = /%([0-9a-f]{2})/gi;
const ROOTLESS_AUTHORITY_URL_PATTERN = /^(?:https?|wss?|ftp):(?!\/\/)/i;
const ROOTLESS_FILE_URL_PATTERN = /^file:(?!\/)/i;
const RFC3986_ILLEGAL_COMPONENT_ASCII_PATTERN = /[ "<>[\]^`{|}]/g;
const SCRIPT_JSON_ESCAPE_PATTERN = /[<>&\u2028\u2029]/g;
const QUERY_OR_HASH_PATTERN = /[?#]/;
const ROOT_AGENT_ARTIFACT_PATTERN =
  /^\/(?:llms(?:-full)?\.txt|robots\.txt|sitemap\.(?:md|xml))$/;
const DOCS_AGENT_ARTIFACT_PATTERN =
  /^\/docs\/(?:agent-readability\.json|llms\.txt|robots\.txt|search-(?:content|index)\.json|sitemap\.(?:md|xml))$/;
const WELL_KNOWN_AGENT_ARTIFACT_PATTERN =
  /^\/\.well-known\/(?:agent-card\.json|agent-skills(?:\/.*)?|api-catalog|llms(?:-full)?\.txt|mcp(?:\.json|\/server-card\.json)?)$/;
const AI_USER_AGENT_PATTERN =
  /\b(amazonbot|anthropic-ai|applebot|bingbot|bytespider|ccbot|chatgpt-user|claude-searchbot|claude-user|claude-web|claudebot|deepseekbot|gemini-deep-research|google-extended|gptbot|meta-externalagent|meta-externalfetcher|metaexternalagent|mistralbot|oai-searchbot|perplexity-user|perplexitybot|youbot)\b/i;

function hasAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= ASCII_CONTROL_MAX_CODE_POINT ||
      codePoint === ASCII_DELETE_CODE_POINT
    ) {
      return true;
    }
  }
  return false;
}

function hasNonAsciiCharacter(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > ASCII_DELETE_CODE_POINT) {
      return true;
    }
  }
  return false;
}

function encodeRfc3986IllegalAscii(value: string): string {
  return value.replace(
    RFC3986_ILLEGAL_COMPONENT_ASCII_PATTERN,
    (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase()}`
  );
}

function serializeRfc3986Url(resolved: URL): string {
  if (!(resolved.host || resolved.pathname.startsWith("/"))) {
    return encodeRfc3986IllegalAscii(resolved.toString());
  }
  resolved.pathname = encodeRfc3986IllegalAscii(resolved.pathname);
  resolved.search = encodeRfc3986IllegalAscii(resolved.search);
  resolved.hash = encodeRfc3986IllegalAscii(resolved.hash);
  return resolved.toString();
}
// Crawlers split by intent (2026 train-vs-retrieve distinction). Retrieval bots
// fetch a page to answer a live query; training bots gather corpora for model
// training. Policies treat the two groups differently.
const RETRIEVAL_AI_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "Claude-Web",
  "Gemini-Deep-Research",
  "DeepSeekBot",
  "Meta-ExternalFetcher",
  "AmazonBot",
  "Amazonbot",
  "Bingbot",
  "MistralBot",
  "AppleBot",
  "YouBot",
] as const;
const TRAINING_AI_CRAWLERS = [
  "GPTBot",
  "Google-Extended",
  "CCBot",
  "ByteSpider",
  "Bytespider",
  "anthropic-ai",
  "MetaExternalAgent",
  "Applebot-Extended",
] as const;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+\-.]*:/i;
const DISCOVERY_BASE_SCHEME = "leadtype:";
const DISCOVERY_BASE_URL = `${DISCOVERY_BASE_SCHEME}//local`;
const ABSOLUTE_FILE_PATH_PATTERN = /^(?:\/|[a-z]:\/)/i;
const ENCODED_PATH_SEPARATOR_PATTERN = /%(?:2f|5c)/i;
const API_CATALOG_URL_PATH = "/.well-known/api-catalog";
/** RFC 9727 profile parameter that marks a linkset as an API catalog. */
const API_CATALOG_PROFILE = "https://www.rfc-editor.org/info/rfc9727";
const API_CATALOG_CONTENT_TYPE = `application/linkset+json; profile="${API_CATALOG_PROFILE}"`;
const DEFAULT_CACHE_CONTROL = "public, max-age=300, must-revalidate";
const SUPPORTED_MANIFEST_VERSION = 1;
const XML_ESCAPE_PATTERN = /[<>&'"]/g;

/* --------------------------- content signals --------------------------- */

export type ContentSignalValue = "yes" | "no";

/**
 * Cloudflare Content-Signals vocabulary, shared between robots.txt (a
 * `Content-Signal:` line) and the `Content-Signal` response header on markdown
 * responses — one config knob, two emitters.
 */
export type ContentSignals = {
  /** Conventional search indexing. */
  search: ContentSignalValue;
  /** Use as live input/grounding for an AI answer (retrieval / RAG). */
  aiInput: ContentSignalValue;
  /** Use to train AI models. */
  aiTrain: ContentSignalValue;
};

/**
 * Crawler-access stance. `balanced` (default) keeps the site fully crawlable but
 * signals "don't train on this"; `open` welcomes training; `block-training`
 * hard-disallows training crawlers; `block-ai` disallows every AI crawler while
 * leaving conventional search engines allowed.
 */
export type RobotsPolicy = "balanced" | "open" | "block-training" | "block-ai";

const ROBOTS_POLICY_SIGNALS: Record<RobotsPolicy, ContentSignals> = {
  balanced: { search: "yes", aiInput: "yes", aiTrain: "no" },
  open: { search: "yes", aiInput: "yes", aiTrain: "yes" },
  "block-training": { search: "yes", aiInput: "yes", aiTrain: "no" },
  "block-ai": { search: "yes", aiInput: "no", aiTrain: "no" },
};

export function resolveContentSignals(
  policy: RobotsPolicy = "balanced",
  overrides?: Partial<ContentSignals>
): ContentSignals {
  return { ...ROBOTS_POLICY_SIGNALS[policy], ...overrides };
}

/** Render the `ai-train=…, search=…, ai-input=…` directive string. */
export function renderContentSignal(signals: ContentSignals): string {
  return `ai-train=${signals.aiTrain}, search=${signals.search}, ai-input=${signals.aiInput}`;
}

export type JsonLdValue = Record<string, unknown>;
export type JsonLdType = string | readonly string[];

export type AgentReadabilityPage = LocalizedDocsMetadata & {
  title: string;
  description: string;
  urlPath: string;
  absoluteUrl: string;
  markdownUrlPath: string;
  markdownAbsoluteUrl: string;
  /** Path to the generated mirror relative to the artifact output directory. */
  markdownFilePath?: string;
  relativePath: string;
  groups: string[];
  lastModified: string;
};

export type DocsTableOfContentsItem = {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  urlPath: string;
  urlWithHash: string;
  absoluteUrlWithHash: string;
  children: DocsTableOfContentsItem[];
};

export type DocsTableOfContentsOptions = {
  minLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  maxLevel?: 1 | 2 | 3 | 4 | 5 | 6;
};

export type DocsNavigationPage = LocalizedDocsMetadata & {
  urlPath: string;
  relativePath: string;
  title: string;
  description: string;
  /** All group slugs the page declared (normalized). */
  groups: string[];
  toc: DocsTableOfContentsItem[];
};

export type DocsNavigationGroup = {
  slug: string;
  segmentPath: string[];
  title: string;
  description?: string;
  pages: DocsNavigationPage[];
  children: DocsNavigationGroup[];
  /** Section is "safe to drop for shorter context" (rendered under `## Optional`). */
  optional?: boolean;
};

export type DocsNavigation = {
  groups: DocsNavigationGroup[];
  ungrouped: DocsNavigationPage[];
  /**
   * Pages that named a group slug not present in the config. `isFallback`
   * (present when locale selection ran) marks entries whose page is the
   * default locale's file re-selected under this locale — the same source
   * file, not a locale-specific defect.
   */
  unknown: { urlPath: string; slug: string; isFallback?: boolean }[];
  locale?: string;
};

export type AgentReadabilityManifest = {
  version: 1;
  generatedAt: string;
  baseUrl: string;
  product: { name: string; summary: string };
  locale?: string;
  i18n?: DocsI18nManifest;
  pages: AgentReadabilityPage[];
  navigation: DocsNavigation;
  files: {
    robotsTxt: string;
    sitemapMd: string;
    sitemapXml: string;
    /**
     * API catalog linkset advertised from homepage `Link` headers. Absent
     * when the site configures no APIs — there is no catalog to serve then.
     */
    apiCatalog?: string;
  };
  /**
   * APIs this site publishes (from site-owned `agents.apis`), baked in so the
   * runtime catalog response matches the statically generated one.
   */
  apis?: ApiCatalogEntry[];
  /** Site-level JSON-LD options (from `agents.jsonLd`), so `renderSiteJsonLd` is config-driven. */
  jsonLd?: RenderSiteJsonLdOptions;
  /** Site-level SEO defaults (from `agents.seo`), emitted by `createDocsHead`. */
  seo?: SeoMeta;
};

export function normalizeAgentReadabilityManifest(
  manifest: unknown
): AgentReadabilityManifest {
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error("leadtype: agent-readability manifest must be an object.");
  }
  return {
    ...manifest,
    version: SUPPORTED_MANIFEST_VERSION,
  } as AgentReadabilityManifest;
}

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

function normalizeSafeRelativeFilePath(input: string): string | null {
  const filePath = normalizeDocsPath(input);
  if (
    !filePath ||
    ABSOLUTE_FILE_PATH_PATTERN.test(filePath) ||
    QUERY_OR_HASH_PATTERN.test(filePath) ||
    ENCODED_PATH_SEPARATOR_PATTERN.test(filePath) ||
    hasAsciiControlCharacter(filePath) ||
    hasUnpairedUtf16Surrogate(filePath)
  ) {
    return null;
  }
  const decodedPath = normalizeDocsPath(
    filePath.replace(VALID_PERCENT_ESCAPE_PATTERN, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
  );
  if (
    ABSOLUTE_FILE_PATH_PATTERN.test(decodedPath) ||
    hasAsciiControlCharacter(decodedPath) ||
    hasUnpairedUtf16Surrogate(decodedPath)
  ) {
    return null;
  }
  const hasUnsafeSegment = (value: string): boolean =>
    value
      .split("/")
      .some(
        (segment) => segment.length === 0 || segment === "." || segment === ".."
      );
  return hasUnsafeSegment(filePath) || hasUnsafeSegment(decodedPath)
    ? null
    : filePath;
}

export type MarkdownReadErrorTarget = Omit<MarkdownMirrorTarget, "filePath"> & {
  /** Absent when the manifest's authored mirror target failed validation. */
  filePath?: string;
};

export type AgentRequestHeaders = Record<string, string | string[] | undefined>;

export type MarkdownResponseHeadersConfig = {
  canonicalUrl: string;
  includeUserAgentVary?: boolean;
  /** Override Cache-Control. Pass `null` to omit the header. */
  cacheControl?: string | null;
  /**
   * Path to the site's `llms.txt`, advertised via `Link: rel="llms-txt"` and
   * `X-Llms-Txt` so agents can discover it from any markdown response. Defaults
   * to `/llms.txt`; pass `null` to omit the discovery headers.
   */
  llmsTxtPath?: string | null;
  /**
   * Cloudflare `Content-Signal` header value. Pass `ContentSignals` (rendered
   * for you) or a prebuilt string. Defaults to the `balanced` policy; pass
   * `null` to omit the header.
   */
  contentSignal?: ContentSignals | string | null;
};

const DEFAULT_LLMS_TXT_PATH = "/llms.txt";

export type EnrichMarkdownFrontmatterConfig = {
  canonicalUrl: string;
  lastUpdated?: string | Date;
  /**
   * Final `last_updated` fallback when neither `lastUpdated` nor the
   * markdown's own frontmatter carries a date. Unlike `lastUpdated`, this
   * never overrides an authored frontmatter date. Defaults to the current
   * time.
   */
  now?: Date;
};

export type RenderMissingMarkdownConfig = {
  urlPath: string;
  canonicalUrl: string;
  lastUpdated?: string | Date;
};

export type RenderUnreadableMarkdownConfig = RenderMissingMarkdownConfig & {
  /** Mirror path that could not be read, e.g. `/docs/quickstart.md`. */
  markdownUrlPath: string;
};

/**
 * Status for a route that resolves to no known page. `200` (the default) keeps
 * the Vercel Agent Readability behaviour: agents get a readable recovery body
 * instead of discarding it with the response. `404` suits sites that would
 * rather have dead-link detection and monitoring see a real miss.
 */
export type MissingMarkdownStatus = 200 | 404;

export type MarkdownReadErrorHandler = (
  target: MarkdownReadErrorTarget,
  cause?: unknown
) => void | Promise<void>;

export type LocalizedAgentReadabilityManifests = Readonly<
  Record<string, AgentReadabilityManifest>
>;

export type CreateAgentMarkdownResponseConfig = {
  urlPath: string;
  method?: string;
  headers?: AgentRequestHeaders;
  manifest: AgentReadabilityManifest;
  readMarkdownFile: (
    target: MarkdownMirrorTarget
  ) => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Additional generated locale manifests, keyed by locale code. Cross-locale
   * reads require the matching manifest so index mirrors and removed pages are
   * resolved from generated metadata rather than guessed file paths.
   */
  localizedManifests?: LocalizedAgentReadabilityManifests;
  /** Report an unreadable mirror before leadtype returns its safe 500 response. */
  onReadError?: MarkdownReadErrorHandler;
  requestOrigin?: string;
  now?: Date;
  /** Override the default AI user-agent regex. */
  userAgentPattern?: RegExp;
  /** Override Cache-Control. Pass `null` to omit. */
  cacheControl?: string | null;
  /**
   * Status for a route with no page behind it — an unknown `.md` path or an
   * agent-shaped request for a URL the manifest never listed. Defaults to
   * `200`, which is what the Vercel Agent Readability behaviour expects: the
   * recovery body reaches the agent instead of being discarded with the
   * status. Set `404` when dead-link detection and monitoring matter more.
   *
   * This never applies to a page the manifest *does* list whose markdown
   * mirror cannot be read — that is a server-side integrity failure, answered
   * with 500 and `Cache-Control: no-store`.
   */
  missingStatus?: MissingMarkdownStatus;
  /**
   * Redirect entries from the generated `docs/redirects.json`. Agent-shaped
   * requests for a renamed page (including its `.md` mirror) get a 308 to the
   * new location; acknowledged removals get 410 Gone. Non-agent requests
   * still fall through so the host app can redirect the HTML route itself
   * with `resolveRedirect` from `leadtype/redirects`.
   */
  redirects?: DocsRedirect[];
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

/**
 * Paths advertised in the site-wide discovery `Link` header — the header
 * surface, i.e. which artifacts a homepage or markdown response points at.
 * The API catalog's own membership is configured separately with
 * {@link ApiCatalogEntry}, because a catalog member is an API, not a docs
 * artifact.
 */
export type AgentDiscoveryLinksConfig = {
  /**
   * The generated manifest, used to decide whether an API catalog exists at
   * all: without one, the `api-catalog` link is dropped rather than pointed at
   * a 404. Pass it whenever you have it.
   */
  manifest?: AgentReadabilityManifest;
  /**
   * API catalog path. Defaults to the manifest's `files.apiCatalog`, or is
   * omitted when no manifest is given. Pass a path to opt in explicitly.
   */
  apiCatalogPath?: string | null;
  /** Human/agent-facing service documentation path. Defaults to `/docs/llms.txt`. */
  serviceDocPath?: string | null;
  /**
   * Machine-readable API description (OpenAPI, AsyncAPI, …). No default: docs
   * artifacts describe documentation, not an API contract, so leadtype only
   * advertises `service-desc` when a site names a real one.
   */
  serviceDescPath?: string | null;
  /** Printable-ASCII media type for `serviceDescPath`. Defaults to `application/json`. */
  serviceDescType?: string;
  /** Sitemap or equivalent descriptor path. Defaults to `/sitemap.xml`. */
  describedbyPath?: string | null;
};

/**
 * One link target inside an API catalog entry — an OpenAPI description, a
 * documentation page, a status page. `href` may be root-relative
 * (`/openapi.json`), document-relative (`openapi.json`), or absolute
 * (`https://api.example.com/openapi.json`). Relative hrefs resolve against
 * the publishing origin; absolute hrefs keep their own origin.
 */
export type ApiCatalogLink = {
  href: string;
  /** Media type of the target, e.g. `application/vnd.oai.openapi+json;version=3.1`. */
  type?: string;
  /** Human-readable label for the target. */
  title?: string;
};

export type ApiCatalogLinkInput = ApiCatalogLink | ApiCatalogLink[];

/**
 * One API published by this site, listed as an RFC 9727 catalog member. The
 * catalog root links to `href` with `item`; the per-API metadata below is
 * emitted as a second linkset object anchored at the API itself.
 */
export type ApiCatalogEntry = {
  /**
   * The API endpoint. Root-relative, document-relative, or absolute — an
   * absolute `href` publishes a cross-origin API from this catalog.
   */
  href: string;
  /** Human-readable API name, e.g. "Documentation query API". */
  title?: string;
  /** Media type the endpoint itself serves, e.g. `application/json`. */
  type?: string;
  /** API version, emitted as a `version` target attribute on the item link. */
  version?: string;
  /** Machine-readable API description(s) — OpenAPI, AsyncAPI, WSDL. */
  serviceDesc?: ApiCatalogLinkInput;
  /** Human-readable API documentation. */
  serviceDoc?: ApiCatalogLinkInput;
  /** Metadata about the API that is neither description nor documentation. */
  serviceMeta?: ApiCatalogLinkInput;
  /** Operational status resource for the API. */
  status?: ApiCatalogLinkInput;
};

export type RenderApiCatalogConfig = {
  manifest: AgentReadabilityManifest;
  /** Live request origin, e.g. "http://localhost:5173". Falls back to manifest.baseUrl. */
  requestOrigin?: string;
  /** APIs to list. Defaults to the manifest's `apis`. */
  apis?: ApiCatalogEntry[];
  /** Catalog path, used as the catalog-root anchor. Defaults to `/.well-known/api-catalog`. */
  apiCatalogPath?: string;
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
  /** NLWeb schema-map path (e.g. `/schema-map.xml`) for a `Schemamap:` directive. */
  schemamapUrlPath?: string;
  /** Allow paths under the User-agent directives. */
  allowPaths?: string[];
  /** Override the AI crawler User-agent list (legacy flat allow-list). */
  userAgents?: readonly string[];
  /** Crawler-access stance. Defaults to `balanced`. */
  policy?: RobotsPolicy;
  /** Override individual Content-Signals beyond the policy preset. */
  signals?: Partial<ContentSignals>;
  /** Override Cache-Control. Pass `null` to omit. */
  cacheControl?: string | null;
};

export type CreateApiCatalogResponseConfig = RenderApiCatalogConfig & {
  /** Override Cache-Control. Pass `null` to omit. */
  cacheControl?: string | null;
  /** Request method. Only GET and HEAD return a response; HEAD has no body. */
  method?: string;
};

export type DocsHeadEntry = Record<string, unknown>;

export type DocsHead = {
  meta: DocsHeadEntry[];
  links: DocsHeadEntry[];
};

export type JsonLdOverrideContext = {
  page: AgentReadabilityPage;
  manifest: AgentReadabilityManifest;
  jsonLd: JsonLdValue;
};

export type DocsJsonLdOverrides = Record<string, unknown> & {
  /**
   * Convenience alias for Schema.org `@type`. This avoids quoted property
   * syntax in the common override path.
   *
   * @defaultValue `"TechArticle"`
   */
  type?: JsonLdType;
  /**
   * Override generated breadcrumbs, or pass `false` to remove generated
   * breadcrumbs from the final JSON-LD object.
   */
  breadcrumb?: JsonLdValue | false;
};

export type DocsJsonLdOverrideInput =
  | DocsJsonLdOverrides
  | ((
      context: JsonLdOverrideContext
    ) => DocsJsonLdOverrides | null | undefined);

export type DocsJsonLdTransform = (
  context: JsonLdOverrideContext
) => JsonLdValue;

export type DocsJsonLdOptions = {
  /** Merge static or per-page fields into the generated JSON-LD defaults. */
  overrides?: DocsJsonLdOverrideInput;
  /**
   * Return the final JSON-LD object. Runs after generated defaults and
   * overrides have been applied.
   */
  transform?: DocsJsonLdTransform;
};

export type CreateDocsJsonLdConfig = DocsJsonLdOptions & {
  urlPath: string;
  manifest: AgentReadabilityManifest;
};

/** Social/SEO metadata defaults, emitted by `createDocsHead`. */
export type SeoMeta = {
  /** Absolute `og:image` / `twitter:image` URL (a social card). leadtype emits the URL, not the image. */
  ogImage?: string;
  /** `twitter:site` handle, e.g. `@acme`. */
  twitterSite?: string;
  /** `keywords` meta (joined with commas). */
  keywords?: string[];
};

export type CreateDocsHeadConfig = {
  urlPath: string;
  manifest: AgentReadabilityManifest;
  /** Key under which the JSON-LD payload is embedded in `meta`. Default: "script:ld+json" (TanStack Router). */
  jsonLdMetaKey?: string;
  /** Optional JSON-LD overrides passed through to `createDocsJsonLd`. */
  jsonLd?: DocsJsonLdOptions;
  /** Per-page SEO overrides; merged over the manifest's site-level `seo` defaults. */
  seo?: SeoMeta;
};

export type RenderSitemapMarkdownConfig = {
  product: { name: string };
  navigation: DocsNavigation;
  pages: AgentReadabilityPage[];
};

export type RenderRobotsTxtConfig = {
  baseUrl?: string;
  sitemapUrlPath?: string;
  /**
   * NLWeb schema-map URL path (e.g. `/schema-map.xml`). When set, robots.txt
   * gains a `Schemamap:` directive pointing natural-language retrieval
   * systems at the site's schema.org feeds.
   */
  schemamapUrlPath?: string;
  allowPaths?: string[];
  /**
   * Legacy: a flat allow-list of crawler user-agents. When set, every listed
   * agent is allowed (pre-policy behavior). Prefer `policy` for the
   * train-vs-retrieve split.
   */
  userAgents?: readonly string[];
  /** Crawler-access stance. Defaults to `balanced`. */
  policy?: RobotsPolicy;
  /** Override individual Content-Signals beyond the policy preset. */
  signals?: Partial<ContentSignals>;
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
  return `"${value.replace(QUOTED_STRING_ESCAPE_PATTERN, "\\$&")}"`;
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

export function isAgentReadabilityArtifactPath(
  urlPath: string,
  manifest?: AgentReadabilityManifest
): boolean {
  const pathname = normalizeUrlPath(urlPath);
  if (
    ROOT_AGENT_ARTIFACT_PATTERN.test(pathname) ||
    DOCS_AGENT_ARTIFACT_PATTERN.test(pathname) ||
    WELL_KNOWN_AGENT_ARTIFACT_PATTERN.test(pathname)
  ) {
    return true;
  }
  for (const artifact of manifest?.i18n?.artifacts ?? []) {
    const artifactPaths = [
      artifact.llmsTxt,
      artifact.llmsFullTxt,
      artifact.searchIndex,
      artifact.searchContent,
      artifact.agentReadabilityManifest,
      artifact.robotsTxt,
      artifact.sitemapMd,
      artifact.sitemapXml,
    ];
    if (
      artifactPaths.some(
        (artifactPath) =>
          artifactPath !== undefined &&
          normalizeUrlPath(artifactPath) === pathname
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Which catalog path the discovery header should advertise. A manifest is
 * authoritative: `leadtype generate` only records `files.apiCatalog` when the
 * site declares APIs, so its absence means there is no catalog to point at.
 * Without a manifest, fail closed: callers can opt in with `apiCatalogPath`,
 * but should not advertise a catalog that may not exist.
 */
function resolveAdvertisedApiCatalogPath(
  manifest: AgentReadabilityManifest | undefined
): string | null {
  if (!manifest) {
    return null;
  }
  return manifest.apis?.length ? (manifest.files.apiCatalog ?? null) : null;
}

function normalizeDiscoveryPath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) {
    throw new Error("leadtype: discovery URL must not be empty.");
  }
  if (hasAsciiControlCharacter(pathname)) {
    throw new Error(
      "leadtype: discovery URL must not contain ASCII control characters."
    );
  }
  if (hasUnpairedUtf16Surrogate(pathname)) {
    throw new Error(
      "leadtype: discovery URL must not contain unpaired UTF-16 surrogates."
    );
  }
  if (pathname.includes("\\")) {
    throw new Error("leadtype: discovery URL must not contain backslashes.");
  }
  if (INVALID_PERCENT_ESCAPE_PATTERN.test(trimmed)) {
    throw new Error(
      "leadtype: discovery URL must not contain a malformed percent escape."
    );
  }
  if (
    ROOTLESS_AUTHORITY_URL_PATTERN.test(trimmed) ||
    ROOTLESS_FILE_URL_PATTERN.test(trimmed)
  ) {
    throw new Error(
      "leadtype: discovery URL must use the required slashes after its URL scheme."
    );
  }
  const hasScheme = URI_SCHEME_PATTERN.test(trimmed);
  try {
    if (hasScheme) {
      const resolved = new URL(trimmed);
      return serializeRfc3986Url(resolved);
    }
    const resolved = new URL(trimmed, DISCOVERY_BASE_URL);
    const serialized = serializeRfc3986Url(resolved);
    if (trimmed.startsWith("//")) {
      return serialized.slice(DISCOVERY_BASE_SCHEME.length);
    }
    const resolvedPathname = resolved.pathname.startsWith("//")
      ? `/.${resolved.pathname}`
      : resolved.pathname;
    return `${resolvedPathname}${resolved.search}${resolved.hash}`;
  } catch {
    const description = hasScheme ? "absolute URL" : "URI-reference";
    throw new Error(
      `leadtype: discovery URL is not a valid ${description} (${JSON.stringify(pathname)}).`
    );
  }
}

function quotedLink(pathname: string, params: Record<string, string>): string {
  const serializedParams = Object.entries(params)
    .map(([key, value]) => {
      if (hasAsciiControlCharacter(value)) {
        throw new Error(
          "leadtype: discovery Link parameters must not contain ASCII control characters."
        );
      }
      if (hasNonAsciiCharacter(value)) {
        throw new Error(
          "leadtype: discovery Link parameters must contain only printable ASCII characters."
        );
      }
      return `${key}="${value.replace(QUOTED_STRING_ESCAPE_PATTERN, "\\$&")}"`;
    })
    .join("; ");
  return `<${pathname}>; ${serializedParams}`;
}

function assertMediaType(value: string, field: string): string {
  if (!isAsciiMediaType(value)) {
    throw new Error(
      `leadtype: ${field} must be a valid ASCII media type (${JSON.stringify(value)}).`
    );
  }
  return value;
}

export function createAgentDiscoveryLinkHeader(
  config: AgentDiscoveryLinksConfig = {}
): string {
  const links: string[] = [];
  const apiCatalogPath =
    config.apiCatalogPath === undefined
      ? resolveAdvertisedApiCatalogPath(config.manifest)
      : config.apiCatalogPath;
  const serviceDocPath =
    config.serviceDocPath === undefined
      ? "/docs/llms.txt"
      : config.serviceDocPath;
  const serviceDescPath = config.serviceDescPath ?? null;
  const describedbyPath =
    config.describedbyPath === undefined
      ? "/sitemap.xml"
      : config.describedbyPath;

  if (apiCatalogPath !== null) {
    links.push(
      quotedLink(normalizeDiscoveryPath(apiCatalogPath), {
        rel: "api-catalog",
        type: "application/linkset+json",
      })
    );
  }
  if (serviceDocPath !== null) {
    links.push(
      quotedLink(normalizeDiscoveryPath(serviceDocPath), {
        rel: "service-doc",
        type: "text/plain",
      })
    );
  }
  if (serviceDescPath !== null) {
    links.push(
      quotedLink(normalizeDiscoveryPath(serviceDescPath), {
        rel: "service-desc",
        type: assertMediaType(
          config.serviceDescType ?? "application/json",
          "serviceDescType"
        ),
      })
    );
  }
  if (describedbyPath !== null) {
    links.push(
      quotedLink(normalizeDiscoveryPath(describedbyPath), {
        rel: "describedby",
        type: "application/xml",
      })
    );
  }
  return links.join(", ");
}

export function createAgentDiscoveryHeaders(
  config: AgentDiscoveryLinksConfig = {}
): Record<string, string> {
  const link = createAgentDiscoveryLinkHeader(config);
  return link ? { Link: link } : {};
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
  const relativePath = normalizeSafeRelativeFilePath(
    withoutExtension.slice("/docs/".length)
  );
  if (!relativePath) {
    return null;
  }
  const filePath = normalizeSafeRelativeFilePath(
    `${DOCS_DIRNAME}/${relativePath}.md`
  );
  if (!filePath) {
    return null;
  }

  return {
    urlPath: withoutExtension,
    markdownUrlPath: `${withoutExtension}.md`,
    filePath,
    relativePath,
  };
}

/**
 * Resolve a page's Markdown mirror from the manifest entry (not the raw public
 * route), using the per-page path recorded by the generator. Manifests created
 * before `markdownFilePath` existed fall back to the docs-tree layout,
 * `docs/<relativePath>.md`.
 */
export function resolveManifestMarkdownMirrorTarget(
  urlPath: string,
  manifest: AgentReadabilityManifest
): MarkdownMirrorTarget | null {
  const page = findManifestMarkdownPage(urlPath, manifest);
  if (!page) {
    return null;
  }
  const relativePath = normalizeSafeRelativeFilePath(page.relativePath);
  if (!relativePath) {
    return null;
  }
  const filePath = normalizeSafeRelativeFilePath(
    page.markdownFilePath ?? `${DOCS_DIRNAME}/${relativePath}.md`
  );
  if (!filePath) {
    return null;
  }
  return {
    urlPath: page.urlPath,
    markdownUrlPath: page.markdownUrlPath,
    filePath,
    relativePath,
  };
}

function resolveLegacyRootMarkdownMirrorTarget(
  page: AgentReadabilityPage,
  primaryTarget: MarkdownMirrorTarget
): MarkdownMirrorTarget | null {
  if (page.markdownFilePath !== undefined) {
    return null;
  }
  const markdownUrlPath = normalizeDocsPath(page.markdownUrlPath);
  if (!markdownUrlPath.startsWith("/")) {
    return null;
  }
  const filePath = normalizeSafeRelativeFilePath(markdownUrlPath.slice(1));
  if (!filePath || filePath === primaryTarget.filePath) {
    return null;
  }
  return { ...primaryTarget, filePath };
}

function isLegacyByopMarkdownMirror(
  markdown: string,
  page: AgentReadabilityPage
): boolean {
  // Both legacy generators omitted markdownFilePath. Only BYOP wrote root
  // mirrors with these manifest-derived fields, so require both before
  // accepting a root retry from an otherwise ambiguous manifest.
  const frontmatter = markdown.match(FRONTMATTER_BLOCK_PATTERN)?.[1];
  if (!frontmatter) {
    return false;
  }
  const canonicalUrl = readFrontmatterField(frontmatter, ["canonical_url"]);
  const lastUpdated = normalizeDate(
    readFrontmatterField(frontmatter, ["last_updated"])
  );
  const pageLastModified = normalizeDate(page.lastModified);
  return (
    canonicalUrl === page.absoluteUrl &&
    lastUpdated !== undefined &&
    pageLastModified !== undefined &&
    lastUpdated === pageLastModified
  );
}

function findManifestMarkdownPage(
  urlPath: string,
  manifest: AgentReadabilityManifest
): AgentReadabilityPage | undefined {
  const normalizedPathname = normalizeUrlPath(urlPath);
  const pathname =
    normalizedPathname === "/"
      ? normalizedPathname
      : normalizedPathname.replace(TRAILING_SLASH_PATTERN, "");
  return manifest.pages.find(
    (entry) => entry.urlPath === pathname || entry.markdownUrlPath === pathname
  );
}

/* ----------------------- markdown response builders -------------------- */

export function createMarkdownResponseHeaders(
  config: MarkdownResponseHeadersConfig
): Record<string, string> {
  const linkParts = [`<${config.canonicalUrl}>; rel="canonical"`];
  const llmsTxtPath =
    config.llmsTxtPath === undefined
      ? DEFAULT_LLMS_TXT_PATH
      : config.llmsTxtPath;
  const headers: Record<string, string> = {
    "Content-Type": "text/markdown; charset=utf-8",
    Vary: config.includeUserAgentVary ? "Accept, User-Agent" : "Accept",
  };
  if (llmsTxtPath !== null) {
    linkParts.push(`<${llmsTxtPath}>; rel="llms-txt"`);
    headers["X-Llms-Txt"] = llmsTxtPath;
  }
  headers.Link = linkParts.join(", ");
  const contentSignal =
    config.contentSignal === undefined
      ? resolveContentSignals("balanced")
      : config.contentSignal;
  if (contentSignal !== null) {
    headers["Content-Signal"] =
      typeof contentSignal === "string"
        ? contentSignal
        : renderContentSignal(contentSignal);
  }
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
      (config.now ?? new Date()).toISOString();
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

/**
 * Body for a page the manifest lists whose markdown mirror could not be read.
 * Deliberately not the "page not found" body: the page exists, the mirror is
 * missing or unreachable, and telling an agent otherwise teaches it that a
 * real URL is dead. Served with 500 so retries and monitoring see the failure.
 */
export function renderUnreadableMarkdown(
  config: RenderUnreadableMarkdownConfig
): string {
  const lastUpdated =
    normalizeDate(config.lastUpdated) ?? new Date().toISOString();
  return `---
title: "Markdown temporarily unavailable"
description: ${toYamlScalar(`The markdown mirror for ${config.urlPath} could not be read.`)}
canonical_url: ${toYamlScalar(config.canonicalUrl)}
last_updated: ${toYamlScalar(lastUpdated)}
---
# Markdown temporarily unavailable

This page exists at \`${config.urlPath}\`, but its markdown mirror at \`${config.markdownUrlPath}\` could not be read. This is a server-side error, not a missing page — do not treat the URL as dead.

Retry the request, or read the page at [${config.canonicalUrl}](${config.canonicalUrl}).
`;
}

/* ----------------------- JSON-LD helpers ------------------------------- */

type BreadcrumbCrumb = { name: string; url?: string };

const DOCS_ROOT_SEGMENT = "docs";

/**
 * Walk the navigation tree to find the chain of groups that contains `page`,
 * outermost first. Returns `[]` for ungrouped pages, which yields the simple
 * Docs → page breadcrumb.
 */
function findGroupTrail(
  groups: DocsNavigationGroup[] | undefined,
  urlPath: string
): DocsNavigationGroup[] {
  if (!groups) {
    return [];
  }
  for (const group of groups) {
    if (group.pages?.some((entry) => entry.urlPath === urlPath)) {
      return [group];
    }
    const childTrail = findGroupTrail(group.children, urlPath);
    if (childTrail.length > 0) {
      return [group, ...childTrail];
    }
  }
  return [];
}

/**
 * The outermost nav node is often a "Docs" tab that maps to the `/docs` root
 * (segmentPath `["docs"]`). That's already the breadcrumb home, so drop it to
 * avoid a duplicate `Docs → Docs` trail and a useless `articleSection`.
 */
function sectionTrail(trail: DocsNavigationGroup[]): DocsNavigationGroup[] {
  const first = trail.at(0);
  const isDocsRootContainer =
    first?.segmentPath.length === 1 &&
    first.segmentPath[0] === DOCS_ROOT_SEGMENT;
  return isDocsRootContainer ? trail.slice(1) : trail;
}

function buildBreadcrumb(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest,
  sections: DocsNavigationGroup[]
): JsonLdValue {
  // Section crumbs are name-only: a group's segmentPath is a structural nav
  // path, not a URL, and sections rarely have their own landing page. The home
  // and leaf crumbs carry the URLs agents resolve.
  const crumbs: BreadcrumbCrumb[] = [
    { name: "Docs", url: `${manifest.baseUrl}/docs` },
    ...sections.map((group) => ({ name: group.title })),
    { name: page.title, url: page.absoluteUrl },
  ];

  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      ...(crumb.url ? { item: crumb.url } : {}),
    })),
  };
}

const REFERENCE_SECTION_PATTERN = /^(reference|api)$/i;
const REFERENCE_PATH_PATTERN = /(^|\/)(reference|api)(\/|$)/i;

/**
 * Stable `@id`s for the site-level entities, derived from the base URL. Per-page
 * JSON-LD references these instead of re-inlining the Organization/WebSite, so an
 * answer engine can stitch every page into one entity graph (DESIGN.md Phase 4).
 */
function jsonLdEntityIds(baseUrl: string): {
  organization: string;
  website: string;
  software: string;
} {
  const base = stripTrailingSlashes(baseUrl);
  return {
    organization: `${base}/#organization`,
    website: `${base}/#website`,
    software: `${base}/#software`,
  };
}

export function renderJsonLd(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): JsonLdValue {
  assertManifestVersion(manifest);
  const sections = sectionTrail(
    findGroupTrail(manifest.navigation?.groups, page.urlPath)
  );
  const breadcrumb = buildBreadcrumb(page, manifest, sections);
  const articleSection = sections.at(0)?.title;
  const ids = jsonLdEntityIds(manifest.baseUrl);
  // Reference pages are additionally typed as APIReference so answer engines can
  // distinguish prose from the API surface. Keyed on the page's own path as well as
  // its nav section, so a /reference/ page stays APIReference even when the sidebar
  // groups it elsewhere.
  const isApiReference =
    REFERENCE_PATH_PATTERN.test(page.relativePath) ||
    sections.some((section) => REFERENCE_SECTION_PATTERN.test(section.slug));
  return {
    "@context": "https://schema.org",
    "@type": isApiReference ? ["TechArticle", "APIReference"] : "TechArticle",
    headline: page.title,
    name: page.title,
    description: jsonLdPageDescription(page, manifest),
    url: page.absoluteUrl,
    mainEntityOfPage: page.absoluteUrl,
    dateModified: page.lastModified,
    ...(articleSection ? { articleSection } : {}),
    ...(page.locale ? { inLanguage: page.locale } : {}),
    // Reference shared @ids instead of inlining the WebSite/Organization. The
    // site-level graph (renderSiteJsonLd) defines them; emit it once on a root page.
    isPartOf: { "@id": ids.website },
    publisher: { "@id": ids.organization },
    breadcrumb,
  };
}

export type RenderSiteJsonLdOptions = {
  organization?: {
    name?: string;
    url?: string;
    email?: string;
    logo?: string;
    sameAs?: string[];
    contactPoint?:
      | {
          contactType: string;
          email?: string;
          telephone?: string;
          url?: string;
          areaServed?: string | string[];
          availableLanguage?: string | string[];
        }
      | Array<{
          contactType: string;
          email?: string;
          telephone?: string;
          url?: string;
          areaServed?: string | string[];
          availableLanguage?: string | string[];
        }>;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      addressRegion?: string;
      postalCode?: string;
      addressCountry?: string;
    };
  };
  software?: {
    /** Include `SoftwareSourceCode` alongside `SoftwareApplication` for libraries. */
    isLibrary?: boolean;
    applicationCategory?: string;
    operatingSystem?: string;
    /** Source repository URL, emitted as `codeRepository`. */
    codeRepository?: string;
  };
  /**
   * URL template for the WebSite `SearchAction`, relative to the base URL.
   * Defaults to `/docs?q={search_term_string}`. Pass `null` to omit the action.
   */
  searchUrlPattern?: string | null;
};

const DEFAULT_SEARCH_URL_PATTERN = "/docs?q={search_term_string}";

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * The site-level entity graph — `Organization`, `WebSite` (+ `SearchAction`), and
 * `SoftwareApplication` (+ `SoftwareSourceCode` for libraries) — emitted once
 * (e.g. on the docs home).
 * Per-page `renderJsonLd` references these by `@id` (DESIGN.md Phase 4).
 */
export function renderSiteJsonLd(
  manifest: AgentReadabilityManifest,
  optionOverrides: RenderSiteJsonLdOptions = {}
): JsonLdValue {
  assertManifestVersion(manifest);
  // Explicit options win over the config baked into the manifest (`agents.jsonLd`).
  const fromManifest = manifest.jsonLd ?? {};
  const options: RenderSiteJsonLdOptions = {
    ...fromManifest,
    ...optionOverrides,
    organization: {
      ...fromManifest.organization,
      ...optionOverrides.organization,
    },
    software: { ...fromManifest.software, ...optionOverrides.software },
  };
  const base = stripTrailingSlashes(manifest.baseUrl);
  const ids = jsonLdEntityIds(base);

  // `[]` is truthy — normalize first so an empty array is omitted like sameAs.
  const contactPoints = options.organization?.contactPoint
    ? toArray(options.organization.contactPoint).map((contactPoint) => ({
        "@type": "ContactPoint",
        ...contactPoint,
      }))
    : [];

  const organization: JsonLdValue = {
    "@type": "Organization",
    "@id": ids.organization,
    name: options.organization?.name ?? manifest.product.name,
    url: options.organization?.url ?? base,
    ...(options.organization?.email
      ? { email: options.organization.email }
      : {}),
    ...(options.organization?.logo ? { logo: options.organization.logo } : {}),
    ...(options.organization?.sameAs && options.organization.sameAs.length > 0
      ? { sameAs: options.organization.sameAs }
      : {}),
    ...(contactPoints.length > 0 ? { contactPoint: contactPoints } : {}),
    ...(options.organization?.address
      ? {
          address: {
            "@type": "PostalAddress",
            ...options.organization.address,
          },
        }
      : {}),
  };

  const website: JsonLdValue = {
    "@type": "WebSite",
    "@id": ids.website,
    name: manifest.product.name,
    url: base,
    publisher: { "@id": ids.organization },
  };
  const searchUrlPattern =
    options.searchUrlPattern === undefined
      ? DEFAULT_SEARCH_URL_PATTERN
      : options.searchUrlPattern;
  if (searchUrlPattern !== null) {
    website.potentialAction = {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${base}${searchUrlPattern}`,
      },
      "query-input": "required name=search_term_string",
    };
  }

  const software: JsonLdValue = {
    "@type": options.software?.isLibrary
      ? ["SoftwareApplication", "SoftwareSourceCode"]
      : "SoftwareApplication",
    "@id": ids.software,
    name: manifest.product.name,
    description: manifest.product.summary,
    url: base,
    publisher: { "@id": ids.organization },
    ...(options.software?.applicationCategory
      ? { applicationCategory: options.software.applicationCategory }
      : {}),
    ...(options.software?.operatingSystem
      ? { operatingSystem: options.software.operatingSystem }
      : {}),
    ...(options.software?.codeRepository
      ? { codeRepository: options.software.codeRepository }
      : {}),
  };

  return {
    "@context": "https://schema.org",
    "@graph": [organization, website, software],
  };
}

const JSON_LD_DATE_FIELDS = ["dateModified", "datePublished", "dateCreated"];
const ARTICLE_TYPE_PATTERN = /article/i;

function isValidDateString(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function jsonLdTypes(node: JsonLdValue): string[] {
  const type = node["@type"];
  if (typeof type === "string") {
    return [type];
  }
  if (Array.isArray(type)) {
    return type.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function validateJsonLdNode(
  node: JsonLdValue,
  nodePath: string,
  issues: string[]
): void {
  const types = jsonLdTypes(node);
  if (types.length === 0) {
    issues.push(`${nodePath}: missing or invalid @type`);
  }
  if (
    "@id" in node &&
    !(typeof node["@id"] === "string" && (node["@id"] as string).length > 0)
  ) {
    issues.push(`${nodePath}: @id must be a non-empty string`);
  }
  if ("url" in node && !(typeof node.url === "string" && node.url.length > 0)) {
    issues.push(`${nodePath}: url must be a non-empty string`);
  }
  for (const field of JSON_LD_DATE_FIELDS) {
    if (field in node && !isValidDateString(node[field])) {
      issues.push(
        `${nodePath}: ${field} is not a valid date ("${String(node[field])}")`
      );
    }
  }
  if (
    types.some((type) => ARTICLE_TYPE_PATTERN.test(type)) &&
    !(node.headline || node.name)
  ) {
    issues.push(`${nodePath}: ${types.join(", ")} requires a headline or name`);
  }
}

/**
 * Structurally validates a JSON-LD object (or `@graph`) — broken schema is worse
 * than none (DESIGN.md Phase 4). Returns a list of human-readable issues; an empty
 * array means valid. Checks `@context`, `@type`, `@id` references, `url`, ISO dates,
 * and that article-like nodes carry a headline/name. Not a full Schema.org validator.
 */
export function validateJsonLd(value: JsonLdValue): string[] {
  const issues: string[] = [];
  if (
    !(typeof value["@context"] === "string" && value["@context"].length > 0)
  ) {
    issues.push("root: missing or empty @context");
  }
  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    if (graph.length === 0) {
      issues.push("@graph: must not be empty");
    }
    graph.forEach((node, index) => {
      if (node && typeof node === "object") {
        validateJsonLdNode(node as JsonLdValue, `@graph[${index}]`, issues);
      } else {
        issues.push(`@graph[${index}]: not an object`);
      }
    });
  } else {
    validateJsonLdNode(value, "root", issues);
  }
  return issues;
}

export function stringifyJsonLd(value: JsonLdValue): string {
  return jsonScriptEscape(JSON.stringify(value));
}

export function renderJsonLdScript(
  page: AgentReadabilityPage,
  manifest: AgentReadabilityManifest
): string {
  const json = stringifyJsonLd(renderJsonLd(page, manifest));
  return `<script type="application/ld+json">${json}</script>`;
}

function applyJsonLdOverrides(
  jsonLd: JsonLdValue,
  overrides: DocsJsonLdOverrides
): JsonLdValue {
  const { breadcrumb, type, ...rest } = overrides;
  const next: JsonLdValue = { ...jsonLd, ...rest };

  if (type !== undefined) {
    next["@type"] = type;
  }
  if (breadcrumb === false) {
    const { breadcrumb: _breadcrumb, ...withoutBreadcrumb } = next;
    return withoutBreadcrumb;
  }
  if (breadcrumb !== undefined) {
    next.breadcrumb = breadcrumb;
  }

  return next;
}

export function createDocsJsonLd(
  config: CreateDocsJsonLdConfig
): JsonLdValue | null {
  assertManifestVersion(config.manifest);
  const page = config.manifest.pages.find(
    (entry) => entry.urlPath === config.urlPath
  );
  if (!page) {
    return null;
  }

  let jsonLd = renderJsonLd(page, config.manifest);
  if (config.overrides) {
    const context = { page, manifest: config.manifest, jsonLd };
    const overrides =
      typeof config.overrides === "function"
        ? config.overrides(context)
        : config.overrides;
    if (overrides) {
      jsonLd = applyJsonLdOverrides(jsonLd, overrides);
    }
  }

  if (config.transform) {
    return config.transform({ page, manifest: config.manifest, jsonLd });
  }

  return jsonLd;
}

/* ----------------------- markdown content negotiation ------------------ */

/**
 * Recovery response for a route with no page behind it. The body is the same
 * agent-readable "page not found" markdown at either status; only the status
 * line differs, so a site can pick discoverability (200) or dead-link
 * detection (404) without losing the recovery links.
 */
function missingMarkdownResponse(args: {
  urlPath: string;
  canonicalUrl: string;
  config: CreateAgentMarkdownResponseConfig;
  isHead: boolean;
  includeUserAgentVary: boolean;
}): Response {
  const { urlPath, canonicalUrl, config, isHead } = args;
  return new Response(
    isHead
      ? null
      : renderMissingMarkdown({
          urlPath,
          canonicalUrl,
          lastUpdated: config.now,
        }),
    {
      status: config.missingStatus ?? 200,
      headers: createMarkdownResponseHeaders({
        canonicalUrl,
        includeUserAgentVary: args.includeUserAgentVary,
        cacheControl: config.cacheControl,
      }),
    }
  );
}

function unreadableMarkdownResponse(args: {
  target: Pick<MarkdownMirrorTarget, "urlPath" | "markdownUrlPath">;
  canonicalUrl: string;
  config: CreateAgentMarkdownResponseConfig;
  isHead: boolean;
  includeUserAgentVary: boolean;
}): Response {
  const { target, canonicalUrl, config, isHead } = args;
  return new Response(
    isHead
      ? null
      : renderUnreadableMarkdown({
          urlPath: target.urlPath,
          markdownUrlPath: target.markdownUrlPath,
          canonicalUrl,
          lastUpdated: config.now,
        }),
    {
      status: 500,
      headers: createMarkdownResponseHeaders({
        canonicalUrl,
        includeUserAgentVary: args.includeUserAgentVary,
        cacheControl: "no-store",
      }),
    }
  );
}

async function reportMarkdownReadError(
  config: CreateAgentMarkdownResponseConfig,
  target: MarkdownReadErrorTarget,
  cause?: unknown
): Promise<void> {
  try {
    await config.onReadError?.(target, cause);
  } catch {
    // Reporting must not replace the stable, agent-readable response.
  }
}

function findOtherGeneratedLocaleArtifact(
  urlPath: string,
  manifest: AgentReadabilityManifest
): DocsI18nManifest["artifacts"][number] | undefined {
  const currentLocale = manifest.locale ?? manifest.i18n?.defaultLocale;
  let matchedArtifact: DocsI18nManifest["artifacts"][number] | undefined;
  let matchedPrefixLength = -1;
  for (const artifact of manifest.i18n?.artifacts ?? []) {
    const prefix = stripTrailingSlashes(artifact.urlPrefix) || "/";
    const matchesPrefix =
      prefix === "/"
        ? urlPath.startsWith("/")
        : urlPath === prefix || urlPath.startsWith(`${prefix}/`);
    if (matchesPrefix && prefix.length > matchedPrefixLength) {
      matchedArtifact = artifact;
      matchedPrefixLength = prefix.length;
    }
  }
  if (
    matchedArtifact?.locale === currentLocale ||
    matchedArtifact?.agentReadabilityManifest === undefined
  ) {
    return;
  }
  return matchedArtifact;
}

function findRedirectTargetPage(
  urlPath: string,
  manifest: AgentReadabilityManifest,
  localizedManifests: LocalizedAgentReadabilityManifests | undefined
): AgentReadabilityPage | undefined {
  const defaultPage = findManifestMarkdownPage(urlPath, manifest);
  if (defaultPage) {
    return defaultPage;
  }
  const currentLocale = manifest.locale ?? manifest.i18n?.defaultLocale;
  for (const [locale, localizedManifest] of Object.entries(
    localizedManifests ?? {}
  )) {
    if (locale === currentLocale) {
      continue;
    }
    const localizedPage = findManifestMarkdownPage(urlPath, localizedManifest);
    if (
      !localizedPage ||
      (localizedPage.locale !== undefined && localizedPage.locale !== locale)
    ) {
      continue;
    }
    assertManifestVersion(localizedManifest);
    if (localizedManifest.locale !== locale) {
      throw new Error(
        `leadtype: localized manifest for "${locale}" reports locale "${localizedManifest.locale ?? "undefined"}".`
      );
    }
    return localizedPage;
  }
  return;
}

export async function createAgentMarkdownResponse(
  config: CreateAgentMarkdownResponseConfig
): Promise<Response | null> {
  assertManifestVersion(config.manifest);

  const pathname = normalizeUrlPath(config.urlPath);
  if (!readableMethod(config.method)) {
    return null;
  }
  if (isAgentReadabilityArtifactPath(pathname, config.manifest)) {
    return null;
  }

  const accept = getHeaderValue(config.headers, "accept");
  const userAgent = getHeaderValue(config.headers, "user-agent");
  const matchesAgentUa = isAgentUserAgent(userAgent, config.userAgentPattern);
  const wantsMarkdown = acceptsMarkdownHeader(accept) || matchesAgentUa;
  const isHead = config.method === "HEAD";

  // Renamed/removed pages: answer agent-shaped requests before the
  // missing-page fallback would serve a "not found" body for a URL that has
  // a real successor. Non-agent requests keep falling through to the host
  // app's own routing.
  if (config.redirects && (wantsMarkdown || pathname.endsWith(".md"))) {
    const redirect = resolveRedirect(pathname, config.redirects);
    if (redirect) {
      if (redirect.to === undefined) {
        return new Response(isHead ? null : "Gone\n", {
          status: redirect.status,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      // On the .md surface, prefer the target page's recorded mirror path —
      // resolveRedirect's `${to}.md` heuristic is wrong for index routes,
      // whose mirrors live at `${to}/index.md`.
      let toPath = redirect.to;
      if (pathname.endsWith(".md")) {
        const targetUrlPath =
          redirect.to
            .replace(MD_ONLY_EXTENSION_PATTERN, "")
            .replace(TRAILING_SLASH_PATTERN, "") || "/";
        const targetPage = findRedirectTargetPage(
          targetUrlPath,
          config.manifest,
          config.localizedManifests
        );
        if (targetPage) {
          toPath = targetPage.markdownUrlPath;
        }
      }
      const location = toAbsoluteUrl(
        toPath,
        config.requestOrigin
          ? stripTrailingSlashes(config.requestOrigin)
          : config.manifest.baseUrl
      );
      return new Response(null, {
        status: redirect.status,
        headers: { location },
      });
    }
  }

  let resolvedManifest = config.manifest;
  let page = findManifestMarkdownPage(pathname, resolvedManifest);
  let target = resolveManifestMarkdownMirrorTarget(pathname, resolvedManifest);
  if (!page) {
    const localeArtifact = findOtherGeneratedLocaleArtifact(
      pathname,
      config.manifest
    );
    const localizedManifest = localeArtifact
      ? config.localizedManifests?.[localeArtifact.locale]
      : undefined;
    if (localeArtifact && localizedManifest) {
      assertManifestVersion(localizedManifest);
      if (localizedManifest.locale !== localeArtifact.locale) {
        throw new Error(
          `leadtype: localized manifest for "${localeArtifact.locale}" reports locale "${localizedManifest.locale ?? "undefined"}".`
        );
      }
      const localizedPage = findManifestMarkdownPage(
        pathname,
        localizedManifest
      );
      if (localizedPage) {
        resolvedManifest = localizedManifest;
        page = localizedPage;
        target = resolveManifestMarkdownMirrorTarget(
          pathname,
          localizedManifest
        );
      }
    }
    if (!page) {
      const currentLocale =
        config.manifest.locale ?? config.manifest.i18n?.defaultLocale;
      for (const [locale, candidateManifest] of Object.entries(
        config.localizedManifests ?? {}
      )) {
        if (
          locale === currentLocale ||
          candidateManifest === localizedManifest
        ) {
          continue;
        }
        const localizedPage = findManifestMarkdownPage(
          pathname,
          candidateManifest
        );
        if (
          !localizedPage ||
          (localizedPage.locale !== undefined &&
            localizedPage.locale !== locale)
        ) {
          continue;
        }
        assertManifestVersion(candidateManifest);
        if (candidateManifest.locale !== locale) {
          throw new Error(
            `leadtype: localized manifest for "${locale}" reports locale "${candidateManifest.locale ?? "undefined"}".`
          );
        }
        resolvedManifest = candidateManifest;
        page = localizedPage;
        target = resolveManifestMarkdownMirrorTarget(
          pathname,
          candidateManifest
        );
        break;
      }
    }
  }
  if (!page) {
    const fallbackTarget = resolveMarkdownMirrorTarget(pathname);
    const fallbackPage = fallbackTarget
      ? findManifestMarkdownPage(fallbackTarget.urlPath, resolvedManifest)
      : undefined;
    if (fallbackPage) {
      page = fallbackPage;
      target = resolveManifestMarkdownMirrorTarget(
        fallbackPage.markdownUrlPath,
        resolvedManifest
      );
    } else {
      target ??= fallbackTarget;
    }
  }

  if ((target || page) && (wantsMarkdown || pathname.endsWith(".md"))) {
    if (!page) {
      return missingMarkdownResponse({
        urlPath: target?.urlPath ?? pathname,
        canonicalUrl: toAbsoluteUrl(
          target?.urlPath ?? pathname,
          resolvedManifest.baseUrl
        ),
        config,
        isHead,
        includeUserAgentVary: matchesAgentUa,
      });
    }
    const canonicalUrl =
      page.absoluteUrl ?? toAbsoluteUrl(page.urlPath, resolvedManifest.baseUrl);
    if (!target) {
      const invalidTargetCause = new Error(
        `leadtype: agent-readability manifest page ${JSON.stringify(page.urlPath)} has an invalid markdown mirror target (relativePath ${JSON.stringify(page.relativePath)}, markdownFilePath ${JSON.stringify(page.markdownFilePath)}). Regenerate the manifest with valid generated paths.`
      );
      await reportMarkdownReadError(
        config,
        {
          urlPath: page.urlPath,
          markdownUrlPath: page.markdownUrlPath,
          relativePath: page.relativePath,
        },
        invalidTargetCause
      );
      return unreadableMarkdownResponse({
        target: page,
        canonicalUrl,
        config,
        isHead,
        includeUserAgentVary: matchesAgentUa,
      });
    }
    let markdown: string | null | undefined;
    let deferredReadError:
      | { target: MarkdownMirrorTarget; cause: unknown }
      | undefined;
    try {
      markdown = await config.readMarkdownFile(target);
    } catch (error) {
      deferredReadError = { target, cause: error };
    }
    const legacyRootTarget = resolveLegacyRootMarkdownMirrorTarget(
      page,
      target
    );
    if (markdown == null && legacyRootTarget) {
      target = legacyRootTarget;
      try {
        markdown = await config.readMarkdownFile(target);
        if (markdown && !isLegacyByopMarkdownMirror(markdown, page)) {
          markdown = null;
        }
      } catch (error) {
        const readError = deferredReadError ?? { target, cause: error };
        await reportMarkdownReadError(
          config,
          readError.target,
          readError.cause
        );
        return unreadableMarkdownResponse({
          target,
          canonicalUrl,
          config,
          isHead,
          includeUserAgentVary: matchesAgentUa,
        });
      }
    }
    if (markdown) {
      return new Response(
        isHead
          ? null
          : enrichMarkdownFrontmatter(markdown, {
              canonicalUrl,
              // `now` stays a last-resort fallback inside the enricher so a
              // mirror's own authored frontmatter date always wins over the
              // request/generation time.
              lastUpdated: page.lastModified,
              now: config.now,
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
    const readError = deferredReadError ?? { target, cause: undefined };
    await reportMarkdownReadError(config, readError.target, readError.cause);
    // The manifest lists this page, so the mirror was supposed to be there.
    // A missing read is a broken deployment — a stale build output, an
    // unreachable asset host — not a missing page. Answering 200 "page not
    // found" would tell agents a live URL is dead and cache that lie.
    return unreadableMarkdownResponse({
      target,
      canonicalUrl,
      config,
      isHead,
      includeUserAgentVary: matchesAgentUa,
    });
  }

  if (wantsMarkdown || pathname.endsWith(".md")) {
    return missingMarkdownResponse({
      urlPath: pathname,
      canonicalUrl: toAbsoluteUrl(
        pathname,
        config.requestOrigin
          ? stripTrailingSlashes(config.requestOrigin)
          : config.manifest.baseUrl
      ),
      config,
      isHead,
      includeUserAgentVary: matchesAgentUa,
    });
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

function pushCrawlerBlock(
  lines: string[],
  userAgent: string,
  allowPaths: string[],
  disallow: boolean
): void {
  lines.push(`User-agent: ${userAgent}`);
  if (disallow) {
    lines.push("Disallow: /");
  } else {
    for (const allowPath of allowPaths) {
      lines.push(`Allow: ${allowPath}`);
    }
  }
  lines.push("");
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
  const policy = config.policy ?? "balanced";
  const signals = resolveContentSignals(policy, config.signals);

  // `User-agent: *` carries the Content-Signal line + the allow-list.
  const lines = [
    "User-agent: *",
    `Content-Signal: ${renderContentSignal(signals)}`,
  ];
  for (const allowPath of allowPaths) {
    lines.push(`Allow: ${allowPath}`);
  }
  lines.push("");

  if (config.userAgents) {
    // Legacy flat allow-list.
    for (const userAgent of config.userAgents) {
      pushCrawlerBlock(lines, userAgent, allowPaths, false);
    }
  } else {
    const blockRetrieval = policy === "block-ai";
    const blockTraining = policy === "block-ai" || policy === "block-training";
    for (const userAgent of RETRIEVAL_AI_CRAWLERS) {
      pushCrawlerBlock(lines, userAgent, allowPaths, blockRetrieval);
    }
    for (const userAgent of TRAINING_AI_CRAWLERS) {
      pushCrawlerBlock(lines, userAgent, allowPaths, blockTraining);
    }
  }

  lines.push(`Sitemap: ${sitemapUrl}`);
  if (config.schemamapUrlPath) {
    const schemamapUrl = baseUrl
      ? `${baseUrl}${config.schemamapUrlPath}`
      : config.schemamapUrlPath;
    lines.push(`Schemamap: ${schemamapUrl}`);
  }
  lines.push("");
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
  if (!requestOrigin) {
    return stripTrailingSlashes(manifest.baseUrl);
  }
  const requestBase = new URL(requestOrigin);
  try {
    requestBase.pathname = new URL(manifest.baseUrl).pathname;
  } catch {
    requestBase.pathname = "/";
  }
  requestBase.search = "";
  requestBase.hash = "";
  return stripTrailingSlashes(requestBase.toString());
}

/**
 * Resolve an API-catalog `href` against the publishing origin. Absolute hrefs
 * keep their own origin (a catalog may list cross-origin APIs) but are still
 * normalized by `URL`. Relative hrefs resolve against the origin root, so both
 * `/ask` and `ask` land on `${base}/ask`.
 */
function resolveCatalogUrl(href: string, base: string): string {
  const trimmed = href.trim();
  if (!trimmed) {
    throw new Error("leadtype: API catalog href must not be empty.");
  }
  if (hasAsciiControlCharacter(href)) {
    throw new Error(
      "leadtype: API catalog href must not contain ASCII control characters."
    );
  }
  if (hasUnpairedUtf16Surrogate(href)) {
    throw new Error(
      "leadtype: API catalog href must not contain unpaired UTF-16 surrogates."
    );
  }
  if (href.includes("\\")) {
    throw new Error("leadtype: API catalog href must not contain backslashes.");
  }
  if (INVALID_PERCENT_ESCAPE_PATTERN.test(trimmed)) {
    throw new Error(
      `leadtype: API catalog href contains a malformed percent escape ("${href}").`
    );
  }
  if (
    ROOTLESS_AUTHORITY_URL_PATTERN.test(trimmed) ||
    ROOTLESS_FILE_URL_PATTERN.test(trimmed)
  ) {
    throw new Error(
      `leadtype: API catalog href must use the required slashes after its URL scheme (${JSON.stringify(href)}).`
    );
  }
  try {
    const resolved = new URL(trimmed, `${stripTrailingSlashes(base)}/`);
    return serializeRfc3986Url(resolved);
  } catch {
    throw new Error(
      `leadtype: API catalog href is not a valid URL (${JSON.stringify(href)}).`
    );
  }
}

function toCatalogLinks(
  input: ApiCatalogLinkInput | undefined,
  base: string
): Record<string, string>[] | undefined {
  if (!input) {
    return;
  }
  const links = (Array.isArray(input) ? input : [input]).map((link) => ({
    href: resolveCatalogUrl(link.href, base),
    ...(link.type === undefined
      ? {}
      : { type: assertMediaType(link.type, "API catalog link type") }),
    ...(link.title ? { title: link.title } : {}),
  }));
  return links.length > 0 ? links : undefined;
}

/**
 * The APIs a catalog lists: explicit `apis` when given, otherwise the ones
 * baked into the manifest by `leadtype generate`.
 */
export function resolveApiCatalogEntries(
  config: RenderApiCatalogConfig
): ApiCatalogEntry[] {
  return config.apis ?? config.manifest.apis ?? [];
}

/**
 * Render the RFC 9727 API catalog linkset. The first linkset object is
 * anchored at the catalog itself and lists every API with `item`; each API
 * that carries metadata gets a second object anchored at the API, holding its
 * `service-desc`, `service-doc`, `service-meta`, and `status` links.
 *
 * Throws when no APIs are configured — a catalog with no members is not a
 * catalog, and callers are expected to skip publishing one entirely.
 */
export function renderApiCatalog(config: RenderApiCatalogConfig): string {
  assertManifestVersion(config.manifest);
  const apis = resolveApiCatalogEntries(config);
  if (apis.length === 0) {
    throw new Error(
      "leadtype: renderApiCatalog needs at least one API entry. Declare your APIs in `agents.apis`, or skip the catalog when the site publishes none."
    );
  }
  const base = resolveEffectiveBase(config.manifest, config.requestOrigin);
  const catalogUrl = resolveCatalogUrl(
    config.apiCatalogPath ?? API_CATALOG_URL_PATH,
    base
  );

  const items: Record<string, string | string[]>[] = [];
  const anchored: Record<string, unknown>[] = [];
  for (const api of apis) {
    const href = resolveCatalogUrl(api.href, base);
    items.push({
      href,
      ...(api.type === undefined
        ? {}
        : { type: assertMediaType(api.type, "API catalog item type") }),
      ...(api.title ? { title: api.title } : {}),
      ...(api.version ? { version: [api.version] } : {}),
    });
    const relations: Record<string, unknown> = {};
    const serviceDesc = toCatalogLinks(api.serviceDesc, base);
    const serviceDoc = toCatalogLinks(api.serviceDoc, base);
    const serviceMeta = toCatalogLinks(api.serviceMeta, base);
    const status = toCatalogLinks(api.status, base);
    if (serviceDesc) {
      relations["service-desc"] = serviceDesc;
    }
    if (serviceDoc) {
      relations["service-doc"] = serviceDoc;
    }
    if (serviceMeta) {
      relations["service-meta"] = serviceMeta;
    }
    if (status) {
      relations.status = status;
    }
    if (Object.keys(relations).length > 0) {
      anchored.push({ anchor: href, ...relations });
    }
  }

  const linkset = [{ anchor: catalogUrl, item: items }, ...anchored];
  return `${JSON.stringify({ linkset }, null, 2)}\n`;
}

/**
 * Serve the API catalog. Returns `null` when the site publishes no APIs or the
 * method is not GET/HEAD. HEAD returns the same headers with no body. Required
 * framework route handlers turn `null` into a 404; nullable middleware and
 * direct callers can use it to fall through.
 */
export function createApiCatalogResponse(
  config: CreateApiCatalogResponseConfig
): Response | null {
  const method = config.method?.toUpperCase();
  if (!readableMethod(method)) {
    return null;
  }
  if (resolveApiCatalogEntries(config).length === 0) {
    return null;
  }
  const body = renderApiCatalog(config);
  const base = resolveEffectiveBase(config.manifest, config.requestOrigin);
  const catalogUrl = resolveCatalogUrl(
    config.apiCatalogPath ?? API_CATALOG_URL_PATH,
    base
  );
  const isHead = method === "HEAD";
  return new Response(isHead ? null : body, {
    status: 200,
    headers: attachCacheControl(
      {
        "Content-Type": API_CATALOG_CONTENT_TYPE,
        // RFC 9727 §2: a catalog advertises itself, so a HEAD probe alone
        // tells an agent it found one.
        Link: quotedLink(catalogUrl, {
          rel: "api-catalog",
          type: "application/linkset+json",
        }),
      },
      config.cacheControl
    ),
  });
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
  if (config.requestOrigin) {
    baseUrl = new URL(config.requestOrigin).origin;
  } else if (config.manifest) {
    baseUrl = stripTrailingSlashes(config.manifest.baseUrl);
  }
  return new Response(
    renderRobotsTxt({
      baseUrl,
      sitemapUrlPath: config.sitemapUrlPath,
      schemamapUrlPath: config.schemamapUrlPath,
      allowPaths: config.allowPaths,
      userAgents: config.userAgents,
      policy: config.policy,
      signals: config.signals,
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
  const jsonLd = createDocsJsonLd({
    urlPath: config.urlPath,
    manifest: config.manifest,
    ...config.jsonLd,
  });
  const seo: SeoMeta = { ...config.manifest.seo, ...config.seo };
  const seoMeta: DocsHeadEntry[] = [
    { property: "og:type", content: "article" },
    {
      name: "twitter:card",
      content: seo.ogImage ? "summary_large_image" : "summary",
    },
  ];
  if (seo.ogImage) {
    seoMeta.push(
      { property: "og:image", content: seo.ogImage },
      { name: "twitter:image", content: seo.ogImage }
    );
  }
  if (seo.twitterSite) {
    seoMeta.push({ name: "twitter:site", content: seo.twitterSite });
  }
  if (seo.keywords && seo.keywords.length > 0) {
    seoMeta.push({ name: "keywords", content: seo.keywords.join(", ") });
  }

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      ...seoMeta,
      ...(jsonLd ? [{ [jsonLdKey]: jsonLd }] : []),
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
