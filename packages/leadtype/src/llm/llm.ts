import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { PluggableList } from "unified";
import {
  type DocsI18nConfig,
  type DocsI18nManifest,
  type LocaleCode,
  type LocalizedDocsMetadata,
  logicalPathFromLocaleRelativePath,
  normalizeDocsI18nConfig,
  outputRelativePathForLocale,
  toLocalizedDocsUrlPath,
} from "../i18n";
import { slugifyDocsHeading } from "../internal/docs-heading";
import {
  type DocsPathMount,
  GENERIC_DOC_TITLES,
  normalizeBaseUrl,
  normalizeWhitespace as normalizeDescription,
  normalizeDocsPath,
  stripDocsExtension,
  toAbsoluteUrl,
  toMarkdownUrlPath,
  toMountedMarkdownUrlPath,
  toDocsUrlPath as toUrlPath,
} from "../internal/docs-url";
import { parseFrontmatter } from "../internal/frontmatter";
import { logger } from "../internal/logger";
import {
  type DocsFrontmatterSchema,
  type DocsLlmsTxtArtifact,
  type DocsTransformer,
  runTransformers,
} from "../transformers";
import {
  type AgentReadabilityManifest,
  type AgentReadabilityPage,
  type ContentSignals,
  type DocsNavigation,
  type DocsNavigationGroup,
  type DocsNavigationPage,
  type DocsTableOfContentsItem,
  type DocsTableOfContentsOptions,
  type RenderSiteJsonLdOptions,
  type RobotsPolicy,
  renderRobotsTxt,
  renderSitemapMarkdown,
  renderSitemapXml,
  type SeoMeta,
} from "./readability";

export { slugifyDocsHeading } from "../internal/docs-heading";
export type { DocsPathMount } from "../internal/docs-url";

const DOCS_DIRNAME = "docs";
const AGENT_READABILITY_MANIFEST_FILE = "agent-readability.json";
const ROBOTS_FILE = "robots.txt";
const SITEMAP_MARKDOWN_FILE = "sitemap.md";
const SITEMAP_XML_FILE = "sitemap.xml";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const DEFAULT_TOC_MIN_LEVEL = 2;
const DEFAULT_TOC_MAX_LEVEL = 3;
const FRONTMATTER_PATTERN = /^---\s*\n[\s\S]*?\n---\s*\n?/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const FENCE_PATTERN = /^(`{3,}|~{3,})/;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const MARKDOWN_INLINE_PATTERN = /[`*_~>[\](){}|]/g;
const WHITESPACE_PATTERN = /\s+/g;
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/gi;
const NAV_INCLUDE_SORT_DEFAULT = ["order", "path"] as const;

function assertValidGroupSlug(slug: string, parentPath: string[]): string {
  if (!SLUG_PATTERN.test(slug)) {
    const scope = parentPath.join("/") || "root";
    throw new Error(
      `Invalid group slug "${slug}" under "${scope}". Slugs must be URL-safe (alphanumerics and dashes).`
    );
  }
  return slug;
}
const GENERATED_MARKDOWN_FILES = new Set([SITEMAP_MARKDOWN_FILE]);
const SEPARATOR_PATTERN = /[-_]/;

export type SourceDoc = LocalizedDocsMetadata & {
  title: string;
  description: string;
  urlPath: string;
  absoluteUrl: string;
  relativePath: string;
  /** Group slugs declared in frontmatter `group:`. Empty array = ungrouped. */
  groups: string[];
  /**
   * Sidebar order within a group, parsed from frontmatter `order:`. Pages
   * with an explicit order sort first (ascending). Pages without `order`
   * fall back to alphabetical urlPath ordering.
   */
  order?: number;
};

type SourceDocWithContent = SourceDoc & {
  content: string;
};

export type MarkdownDoc = SourceDoc & {
  content: string;
  lastModified: string;
};

export type DocsTableOfContentsPage = Pick<
  SourceDoc,
  "absoluteUrl" | "description" | "relativePath" | "title" | "urlPath"
> & {
  toc: DocsTableOfContentsItem[];
};

export type CuratedLink = {
  urlPath: string;
  title?: string;
  description?: string;
};

/**
 * One content block in the body of `llms.txt`, rendered after the summary
 * blockquote. Blocks render in array order, so position is just the index —
 * there are no placement enums.
 *
 * - `markdown`: a verbatim markdown body under an optional H2 heading. Covers
 *   bullets, prose, popularity stats (stars, downloads), a "Hosted by …"
 *   mention, community links, badges, etc. leadtype never fetches or computes
 *   these values — supply them in `docs.config.ts` (you can fetch at build
 *   time from your own `.ts` config module) or via a `beforeLlmsTxt` transformer.
 * - `links`: a curated link list under an H2 heading, resolved against the
 *   source docs (titles/descriptions auto-filled, URLs rewritten via
 *   mounts/baseUrl), exactly like the legacy `bestStartingPoints` field.
 */
export type LlmsBlock =
  | { type: "markdown"; heading?: string; body: string }
  | { type: "links"; heading: string; links: CuratedLink[] };

/**
 * Identity of the thing being documented. Reused across `llms.txt`, the
 * JSON-LD entity graph, and the A2A agent card — author it once. Who *publishes*
 * the product is a separate concept: see {@link OrganizationInfo}.
 */
export type ProductInfo = {
  /** Product display name, e.g. "DSAR SDK". Rendered as the H1. */
  name: string;
  /**
   * One-line description. Rendered as the `llms.txt` blockquote and reused as
   * the agent-card / JSON-LD description.
   */
  tagline: string;
  /** Canonical product homepage. Agent-card `url` fallback (when no MCP endpoint). */
  homepage?: string;
  /** Docs entry point. Agent-card `documentationUrl`. Defaults to `${baseUrl}/docs`. */
  docs?: string;
  /** Source repository URL. Emitted as JSON-LD `codeRepository` for libraries. */
  repository?: string;
  /**
   * What the product is. `"library"` emits JSON-LD `SoftwareSourceCode`; anything
   * else emits `SoftwareApplication`. Defaults to `"app"`.
   */
  kind?: "library" | "app";
  /** JSON-LD `applicationCategory`, e.g. `"DeveloperApplication"`. */
  category?: string;
};

/**
 * Who publishes / maintains the product. Feeds the JSON-LD `Organization` node
 * and the A2A agent card's `provider`. Distinct from {@link ProductInfo}: the
 * product is the documented thing, the organization is who stands behind it.
 */
export type OrganizationInfo = {
  /** Publisher name, e.g. "Inth". */
  name: string;
  /** Publisher URL, e.g. "https://inth.com". */
  url?: string;
  /** Logo URL, emitted as JSON-LD `Organization.logo`. */
  logo?: string;
};

/** Authored `llms.txt` body. Sections render after the tagline blockquote, in array order. */
export type DocsLlmsConfig = {
  /** Ordered content sections — markdown prose or curated link lists. */
  sections?: LlmsBlock[];
};

/**
 * Internal product shape consumed by the low-level `llms.txt` / `AGENTS.md` /
 * readability-manifest generators: a name, a one-line summary, and ordered body
 * sections. The public config ({@link ProductInfo} + {@link DocsLlmsConfig}) is
 * translated into this at the mapping layer.
 */
export type LlmsProductInfo = {
  name: string;
  summary: string;
  /** Ordered content blocks rendered after the summary blockquote (config `llms.sections`). */
  blocks?: LlmsBlock[];
  /** @deprecated Use `blocks`. Sugar for a `markdown` block titled "Product Summary". */
  bullets?: string[];
  /** @deprecated Use `blocks`. Sugar for a `links` block titled "Best Starting Points". */
  bestStartingPoints?: CuratedLink[];
  /** @deprecated Use `blocks`. Sugar for a `markdown` block titled "Agent Guidance". */
  agentGuidance?: string;
};

/**
 * One entry in a docs navigation group tree. A group with `children` is a
 * router (parent); a group without `children` is a leaf and can directly
 * contain pages whose frontmatter `group:` matches its slug.
 */
export type DocsGroup = {
  slug: string;
  title: string;
  description?: string;
  children?: DocsGroup[];
};

export type DocsNavSortKey = "order" | "path" | "title";

export type DocsNavIncludeEntry = {
  include: string;
  exclude?: string | string[];
  sort?: DocsNavSortKey[];
  required?: boolean;
};

export type DocsNavPageEntry = string | DocsNavIncludeEntry;

/**
 * Author-facing curated navigation tree. `base` cascades to descendants, page
 * strings are extensionless paths relative to the nearest base, and a leading
 * slash escapes back to the collection root.
 */
export type DocsNavNode = {
  title: string;
  slug?: string;
  description?: string;
  base?: string;
  pages?: DocsNavPageEntry[];
  children?: DocsNavNode[];
  /**
   * Mark this section "safe to drop for shorter context". Its pages are listed
   * under a single `## Optional` section in `docs/llms.txt` (the llms.txt spec's
   * convention for low-priority links) instead of their own heading.
   */
  optional?: boolean;
};

/**
 * Top-level curated navigation entry. Strings and include entries become
 * ordered root pages (`navigation.ungrouped`); objects with `title` become
 * grouped navigation sections.
 */
export type DocsNavEntry = DocsNavNode | DocsNavPageEntry;

export type FrameworkNavigationTemplate = Pick<
  DocsNavNode,
  "children" | "description" | "optional" | "pages"
>;

export type FrameworkNavigationVariant<TTemplateName extends string = string> =
  FrameworkNavigationTemplate &
    Pick<DocsNavNode, "title"> & {
      /** Framework URL segment relative to the framework root, e.g. "react". */
      base: string;
      /** Optional stable group key. */
      slug?: string;
      /** Template name to inherit pages/children from. */
      template?: TTemplateName;
    };

type FrameworkNavigationConfigBase = Pick<
  DocsNavNode,
  "base" | "description" | "optional" | "pages" | "slug" | "title"
>;

export type FrameworkNavigationConfig<TTemplateName extends string = string> =
  FrameworkNavigationConfigBase & {
    /**
     * Named framework section templates. Variants inherit `pages`, `children`,
     * `description`, and `optional` from their template unless they override them.
     */
    templates?: Record<TTemplateName, FrameworkNavigationTemplate>;
    /** Ordered framework sections rendered under this navigation node. */
    frameworks: FrameworkNavigationVariant<TTemplateName>[];
  };

type FrameworkNavigationConfigWithTemplates<
  TTemplates extends Record<string, FrameworkNavigationTemplate>,
> = FrameworkNavigationConfigBase & {
  /**
   * Named framework section templates. Variants inherit `pages`, `children`,
   * `description`, and `optional` from their template unless they override them.
   */
  templates: TTemplates;
  /** Ordered framework sections rendered under this navigation node. */
  frameworks: FrameworkNavigationVariant<Extract<keyof TTemplates, string>>[];
};

type FrameworkNavigationConfigWithoutTemplates =
  FrameworkNavigationConfigBase & {
    templates?: undefined;
    /** Ordered framework sections rendered under this navigation node. */
    frameworks: FrameworkNavigationVariant[];
  };

/** Valibot frontmatter schema accepted by a {@link DocsCollection}. */
export type { DocsFrontmatterSchema } from "../transformers";

export type SourceConfigInheritField =
  | "navigation"
  | "groups"
  | "frontmatterSchema"
  | "flatteners"
  | "mounts";

export type SourceConfigInheritance =
  | true
  | {
      /**
       * Config file path relative to the collection `dir`. Defaults to
       * `docs.config.{ts,js,mjs,cjs}` in that directory.
       */
      path?: string;
      /** Source-owned fields to inherit. Defaults to all supported fields. */
      inherit?: SourceConfigInheritField[];
    };

/**
 * One content set in a multi-source docs site. A collection declares where its
 * MDX comes from (local `dir`, or a remote git `repository` at `ref`), how it
 * appears in URLs (`prefix`), and how its frontmatter is validated (`schema`).
 * Multiple collections may share a repository — acquisition is deduped by
 * `(repository, ref)`.
 */
export type DocsCollection = {
  /** https or git@ URL. Omit for a local-only collection. */
  repository?: string;
  /** Branch, tag, or commit SHA. Defaults to `"main"` for remote sources. */
  ref?: string;
  /**
   * Override the cache directory for the cloned repository. Defaults to
   * `.leadtype/sources/<repo-slug>@<ref>` relative to the config dir.
   * Ignored for local-only collections.
   */
  cacheDir?: string;
  /**
   * For remote collections, load source-owned docs config from the synced
   * collection directory after sync and inherit content-owned fields into this
   * collection.
   */
  sourceConfig?: SourceConfigInheritance;
  /**
   * Directory containing the MDX. Relative to the repo root for remote
   * collections, or relative to cwd for local-only collections.
   */
  dir: string;
  /** Optional include globs. Defaults to all `.mdx` files in `dir`. */
  include?: string[];
  /** Optional exclude globs. */
  exclude?: string[];
  /** URL prefix. Defaults to `"/" + <collection-key>`. */
  prefix?: string;
  /**
   * Per-collection frontmatter schema. Defaults to the standard leadtype
   * frontmatter schema. Errors are reported as
   * `[collection:<key>] <relPath>: ...`.
   */
  schema?: DocsFrontmatterSchema;
  /** Per-collection navigation tree. */
  groups?: DocsGroup[];
  /** Per-collection curated docs UI and agent navigation tree. */
  navigation?: DocsNavEntry[];
  /** Optional path-to-URL mounts for pages inside this collection. */
  mounts?: DocsPathMount[];
  /**
   * Custom component flatteners (from `defineComponentFlattener`) declared
   * alongside this collection. Run in the `custom` phase, before the built-in
   * flatteners.
   *
   * @remarks
   * Merged into the build's single flattener list together with the top-level
   * `flatteners` and every other collection's — generation runs one conversion
   * pass over all pages. Flatteners match by component name, so a collection's
   * flatteners effectively apply build-wide; only collections that reuse the
   * same component name with different intended output would collide.
   */
  flatteners?: PluggableList;
};

/**
 * Combined config for the `leadtype` docs-generation pipeline. Pass to
 * `defineDocsConfig` in a `leadtype.config.ts` or `docs.config.ts` file.
 *
 * A config either uses the single-collection shape (top-level `groups`) or
 * the multi-collection shape (`collections` map). Setting both is rejected
 * at config load.
 */
export type DocsConfig<
  TFrontmatter extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Identity of the documented product — name, tagline, links. Reused everywhere. */
  product: ProductInfo;
  /** Who publishes the product. Feeds JSON-LD `Organization` + the agent-card `provider`. */
  organization?: OrganizationInfo;
  /** Authored `llms.txt` body (ordered sections). */
  llms?: DocsLlmsConfig;
  /** Site-wide custom frontmatter schema used by generation/source APIs. */
  frontmatterSchema?: DocsFrontmatterSchema<TFrontmatter>;
  /** Build-time lifecycle hooks for frontmatter, search, and agent artifacts. */
  transformers?: DocsTransformer<TFrontmatter>[];
  /**
   * Custom component flatteners (from `defineComponentFlattener`) applied during
   * generation, in addition to the built-in stack. Run in the `custom` phase —
   * after includes/placeholder resolution, before the built-in flatteners.
   * For multi-collection configs, these merge with each collection's `flatteners`.
   */
  flatteners?: PluggableList;
  /**
   * Top-level navigation for the single-collection shape. Mutually exclusive
   * with `collections`. Pages declare which group they belong to via MDX
   * frontmatter (`group: <slug>` or `group: [a, b]`).
   */
  groups?: DocsGroup[];
  /**
   * Curated navigation for the single-collection shape. When present, this
   * drives docs UI and agent-facing indexes; `groups` remains fallback
   * taxonomy/navigation metadata.
   */
  navigation?: DocsNavEntry[];
  /** Optional path-to-URL mounts for pages inside the docs tree. */
  mounts?: DocsPathMount[];
  /**
   * Multi-source content sets, keyed by collection id. Each collection owns
   * its own source acquisition, URL prefix, frontmatter schema, and nav.
   */
  collections?: Record<string, DocsCollection>;
  i18n?: DocsI18nConfig;
  /**
   * Optional base directory for ExtractedTypeTable / AutoTypeTable path
   * resolution during generation. Relative values are resolved from `--src`.
   */
  typeTableBasePath?: string;
  /** Throw during generation when a referenced type cannot be extracted. */
  typeTableStrict?: boolean;
  /** Agent-surface options (robots policy / Content-Signals, …). All optional. */
  agents?: DocsAgentsConfig;
};

/** A single agent skill (agentskills.io `SKILL.md`). */
export type DocsSkillSpec = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  /** Space- or array-delimited pre-approved tools (rendered as `allowed-tools`). */
  allowedTools?: string[];
  metadata?: Record<string, string>;
  /** Inline Markdown instructions. Use this or `bodyPath`. */
  body?: string;
  /** Path to a Markdown instructions file, relative to the docs source root. */
  bodyPath?: string;
};

/** Additive `agents` config block. All fields optional; zero-config defaults hold. */
export type DocsAgentsConfig = {
  /** Signals that you host a docs MCP endpoint, so leadtype emits MCP discovery surfaces. */
  mcp?: {
    enabled?: boolean;
    /** MCP transport endpoint advertised in the server card. Defaults to `${baseUrl}/mcp` or `/mcp`. */
    endpoint?: string;
    /** Server identity advertised in the MCP Server Card. */
    serverInfo?: {
      name?: string;
      version?: string;
      description?: string;
    };
    /** Static MCP primitive surface advertised before connection. */
    capabilities?: {
      tools?: { listChanged?: boolean };
      resources?: { subscribe?: boolean; listChanged?: boolean };
      prompts?: { listChanged?: boolean };
    };
    /** Whether the advertised MCP endpoint requires authentication. Defaults to public. */
    authentication?: { required?: boolean };
  };
  robots?: {
    /** Crawler-access stance. Defaults to `balanced`. */
    policy?: RobotsPolicy;
    /** Override individual Content-Signals beyond the policy preset. */
    signals?: Partial<ContentSignals>;
  };
  /** Site-level SEO defaults (og:image, twitter, keywords) for `createDocsHead`. */
  seo?: SeoMeta;
  /**
   * The A2A agent card at `/.well-known/agent-card.json`. Its `provider` is the
   * top-level `organization`; `documentationUrl` is `product.docs`. Emitted by default.
   */
  agentCard?: {
    /** Emit the agent card. Default `true`. */
    enabled?: boolean;
    /** Override the card `version`. Defaults to `1.0.0`. */
    version?: string;
  };
  /** Skills surface emitted to `/.well-known/agent-skills` (+ bundled `SKILL.md`). */
  skills?: {
    /** Emit the auto "use these docs" skill. Default `true`. */
    docsSkill?: boolean;
    /** Author-declared skills, emitted alongside (or instead of) the docs-skill. */
    items?: DocsSkillSpec[];
  };
};

/**
 * Identity helper that gives the config object full IDE autocomplete and
 * type-checks the docs structure at edit time.
 */
export function defineDocsConfig<
  TFrontmatter extends Record<string, unknown> = Record<string, unknown>,
>(config: DocsConfig<TFrontmatter>): DocsConfig<TFrontmatter> {
  return config;
}

/**
 * Identity helper for a single collection. Use with
 * {@link defineDocsConfig}'s `collections` map.
 */
export function defineCollection(collection: DocsCollection): DocsCollection {
  return collection;
}

function compactDocsNavNode(node: DocsNavNode): DocsNavNode {
  const compacted: DocsNavNode = { title: node.title };

  if (node.slug !== undefined) {
    compacted.slug = node.slug;
  }
  if (node.description !== undefined) {
    compacted.description = node.description;
  }
  if (node.base !== undefined) {
    compacted.base = node.base;
  }
  if (node.pages !== undefined) {
    compacted.pages = node.pages;
  }
  if (node.children !== undefined) {
    compacted.children = node.children;
  }
  if (node.optional !== undefined) {
    compacted.optional = node.optional;
  }

  return compacted;
}

/**
 * Builds repeated framework navigation from shared templates while returning a
 * plain {@link DocsNavNode}. Use this when React, Next.js, Vue, JavaScript, or
 * other framework sections share the same concepts/guides/reference structure.
 */
export function defineFrameworkNavigation<
  const TTemplates extends Record<string, FrameworkNavigationTemplate>,
>(config: FrameworkNavigationConfigWithTemplates<TTemplates>): DocsNavNode;
export function defineFrameworkNavigation(
  config: FrameworkNavigationConfigWithoutTemplates
): DocsNavNode;
export function defineFrameworkNavigation(
  config: FrameworkNavigationConfig
): DocsNavNode {
  const templates = config.templates ?? {};
  const children = config.frameworks.map((framework) => {
    const template =
      framework.template === undefined
        ? undefined
        : templates[framework.template];

    if (framework.template !== undefined && template === undefined) {
      throw new Error(
        `defineFrameworkNavigation: unknown template "${framework.template}" for framework "${framework.title}"`
      );
    }

    return compactDocsNavNode({
      title: framework.title,
      slug: framework.slug,
      base: framework.base,
      description: framework.description ?? template?.description,
      pages: framework.pages ?? template?.pages,
      children: framework.children ?? template?.children,
      optional: framework.optional ?? template?.optional,
    });
  });

  return compactDocsNavNode({
    title: config.title,
    slug: config.slug,
    base: config.base,
    description: config.description,
    pages: config.pages,
    children,
    optional: config.optional,
  });
}

/** Generator inputs derived from the public config's identity blocks. */
export type ResolvedAgentInputs = {
  /** Internal product shape for `generateLlmsTxt` / `generateAgentReadabilityArtifacts`. */
  product: LlmsProductInfo;
  /** JSON-LD options for `renderSiteJsonLd` (from `organization` + `product` software fields). */
  jsonLd?: RenderSiteJsonLdOptions;
  /** Agent-card `provider` (from `organization`). */
  provider?: { organization: string; url?: string };
  /** Agent-card `documentationUrl` (from `product.docs`). */
  documentationUrl?: string;
};

/**
 * Translate the public config's identity blocks ({@link ProductInfo},
 * {@link OrganizationInfo}, {@link DocsLlmsConfig}) into the inputs the low-level
 * generators consume. One source of truth for the config → generator mapping,
 * shared by `leadtype generate` and anyone composing the generators by hand.
 */
export function resolveAgentInputs(config: {
  product: ProductInfo;
  organization?: OrganizationInfo;
  llms?: DocsLlmsConfig;
}): ResolvedAgentInputs {
  const { product, organization, llms } = config;
  const hasSoftware =
    product.kind !== undefined ||
    product.category !== undefined ||
    product.repository !== undefined;
  const software: RenderSiteJsonLdOptions["software"] | undefined = hasSoftware
    ? {
        ...(product.kind ? { isLibrary: product.kind === "library" } : {}),
        ...(product.category ? { applicationCategory: product.category } : {}),
        ...(product.repository ? { codeRepository: product.repository } : {}),
      }
    : undefined;
  const org = organization
    ? {
        ...(organization.name ? { name: organization.name } : {}),
        ...(organization.url ? { url: organization.url } : {}),
        ...(organization.logo ? { logo: organization.logo } : {}),
      }
    : undefined;
  const jsonLd: RenderSiteJsonLdOptions | undefined =
    org || software
      ? {
          ...(org ? { organization: org } : {}),
          ...(software ? { software } : {}),
        }
      : undefined;
  return {
    product: {
      name: product.name,
      summary: product.tagline,
      ...(llms?.sections ? { blocks: llms.sections } : {}),
    },
    ...(jsonLd ? { jsonLd } : {}),
    ...(organization?.name
      ? {
          provider: {
            organization: organization.name,
            ...(organization.url ? { url: organization.url } : {}),
          },
        }
      : {}),
    ...(product.docs ? { documentationUrl: product.docs } : {}),
  };
}

export type LlmsTxtConfig = {
  srcDir: string;
  outDir: string;
  baseUrl?: string;
  product: LlmsProductInfo;
  /** Group tree from `docs.config.ts`. Used for `/docs/llms.txt` sections. */
  groups?: DocsGroup[];
  /** Curated navigation tree. Preferred over `groups` when present. */
  nav?: DocsNavEntry[];
  /** Optional path-to-URL mounts for generated docs, e.g. changelog -> /changelog. */
  mounts?: DocsPathMount[];
  i18n?: DocsI18nConfig;
  locale?: LocaleCode;
  transformers?: DocsTransformer[];
};

export type LLMFullContextConfig = {
  outDir: string;
  baseUrl?: string;
  product: Pick<LlmsProductInfo, "name">;
  /** Group tree from `docs.config.ts`. Preserved for config validation. */
  groups?: DocsGroup[];
  /** Curated navigation tree. Preferred over `groups` when present. */
  nav?: DocsNavEntry[];
  mounts?: DocsPathMount[];
  i18n?: DocsI18nConfig;
  locale?: LocaleCode;
  transformers?: DocsTransformer[];
};

export type AgentReadabilityConfig = {
  outDir: string;
  baseUrl?: string;
  product: Pick<LlmsProductInfo, "name" | "summary">;
  groups?: DocsGroup[];
  /** Curated navigation tree. Preferred over `groups` when present. */
  nav?: DocsNavEntry[];
  mounts?: DocsPathMount[];
  i18n?: DocsI18nConfig;
  locale?: LocaleCode;
  i18nManifest?: DocsI18nManifest;
  transformers?: DocsTransformer[];
  /** Crawler-access stance for robots.txt + Content-Signals. Defaults to `balanced`. */
  robotsPolicy?: RobotsPolicy;
  /** Override individual Content-Signals beyond the policy preset. */
  contentSignals?: Partial<ContentSignals>;
  /** Site-level JSON-LD options, baked into the manifest for `renderSiteJsonLd`. */
  jsonLd?: RenderSiteJsonLdOptions;
  /** Site-level SEO defaults, baked into the manifest for `createDocsHead`. */
  seo?: SeoMeta;
};

export type AgentReadabilityResult = {
  manifest: AgentReadabilityManifest;
  files: {
    manifest: string;
    robotsTxt: string;
    sitemapMd: string;
    sitemapXml: string;
  };
};

export type ResolveDocsNavigationConfig = {
  srcDir: string;
  baseUrl?: string;
  groups?: DocsGroup[];
  /** Curated navigation tree. Preferred over `groups` when present. */
  nav?: DocsNavEntry[];
  mounts?: DocsPathMount[];
  i18n?: DocsI18nConfig;
  locale?: LocaleCode;
  includeFallback?: boolean;
  toc?: boolean | DocsTableOfContentsOptions;
  /**
   * Name of the docs subdirectory under `srcDir`. Defaults to `"docs"` for
   * backward compatibility. Set this when the docs folder isn't named `docs`
   * (e.g. fumadocs sites using `content/docs` — the directory containing the
   * `.mdx` files would be `srcDir/content`'s `docs` child).
   */
  docsDirName?: string;
};

export type ResolveDocsTableOfContentsConfig = {
  srcDir: string;
  baseUrl?: string;
  mounts?: DocsPathMount[];
  i18n?: DocsI18nConfig;
  locale?: LocaleCode;
  options?: DocsTableOfContentsOptions;
};

type ResolvedGroup = {
  slug: string;
  slugKey: string;
  title: string;
  description?: string;
  segmentPath: string[];
  parent: ResolvedGroup | null;
  children: ResolvedGroup[];
  base: string;
  pageEntries: DocsNavPageEntry[];
  optional?: boolean;
};

function resolveGroups(
  groups: DocsGroup[],
  parentPath: string[] = [],
  parent: ResolvedGroup | null = null
): ResolvedGroup[] {
  const seen = new Set<string>();
  return groups.map((group) => {
    const slug = assertValidGroupSlug(group.slug, parentPath);
    const slugKey = slug.toLowerCase();
    if (seen.has(slugKey)) {
      const scope = parentPath.join("/") || "root";
      throw new Error(
        `Duplicate group slug "${slug}" under "${scope}". Group slugs must be unique among siblings.`
      );
    }
    seen.add(slugKey);

    const segmentPath = [...parentPath, slug];
    const resolved: ResolvedGroup = {
      slug,
      slugKey,
      title: group.title,
      description: group.description,
      segmentPath,
      parent,
      children: [],
      base: "",
      pageEntries: [],
    };
    resolved.children = resolveGroups(
      group.children ?? [],
      segmentPath,
      resolved
    );
    return resolved;
  });
}

function flattenGroups(groups: ResolvedGroup[]): ResolvedGroup[] {
  const result: ResolvedGroup[] = [];
  for (const group of groups) {
    result.push(group);
    if (group.children.length > 0) {
      result.push(...flattenGroups(group.children));
    }
  }
  return result;
}

function inferNavSlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_PATTERN, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeNavPath(input: string): string {
  return stripDocsExtension(normalizeDocsPath(input).replace(/^\/+/, ""))
    .replace(/\/index$/, "")
    .replace(/^index$/, "");
}

function joinNavPath(base: string, input: string): string {
  if (input.trim() === "") {
    return normalizeNavPath(base);
  }
  if (input.startsWith("/")) {
    return normalizeNavPath(input);
  }
  return normalizeNavPath(path.posix.join(base, input));
}

type ResolvedNavConfig = {
  groups: ResolvedGroup[];
  rootPageEntries: DocsNavPageEntry[];
};

function isDocsNavNode(entry: DocsNavEntry): entry is DocsNavNode {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "title" in entry &&
    typeof entry.title === "string"
  );
}

function resolveNavConfig(nav: DocsNavEntry[]): ResolvedNavConfig {
  const rootPageEntries: DocsNavPageEntry[] = [];
  const nodes: DocsNavNode[] = [];
  for (const entry of nav) {
    if (isDocsNavNode(entry)) {
      nodes.push(entry);
    } else {
      rootPageEntries.push(entry);
    }
  }
  return {
    groups: resolveNavGroups(nodes),
    rootPageEntries,
  };
}

function resolveNavGroups(
  nav: DocsNavNode[],
  parentPath: string[] = [],
  parent: ResolvedGroup | null = null,
  inheritedBase = ""
): ResolvedGroup[] {
  const seen = new Set<string>();
  return nav.map((node) => {
    const inferredSlug = inferNavSlug(node.slug ?? node.title);
    const slug = assertValidGroupSlug(inferredSlug, parentPath);
    const slugKey = slug.toLowerCase();
    if (seen.has(slugKey)) {
      const scope = parentPath.join("/") || "root";
      throw new Error(
        `Duplicate nav slug "${slug}" under "${scope}". Nav slugs must be unique among siblings.`
      );
    }
    seen.add(slugKey);

    const base =
      node.base === undefined
        ? inheritedBase
        : joinNavPath(inheritedBase, node.base);
    const segmentPath = [...parentPath, slug];
    const resolved: ResolvedGroup = {
      slug,
      slugKey,
      title: node.title,
      description: node.description,
      segmentPath,
      parent,
      children: [],
      base,
      pageEntries: node.pages ?? [],
      ...(node.optional ? { optional: true } : {}),
    };
    resolved.children = resolveNavGroups(
      node.children ?? [],
      segmentPath,
      resolved,
      base
    );
    return resolved;
  });
}

function titleize(input: string): string {
  return input
    .split(SEPARATOR_PATTERN)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function titleFromRelativePath(
  relativePath: string,
  extension: ".md" | ".mdx"
): string {
  const fileName = path.basename(relativePath, extension);
  const parentSegment = path.basename(path.dirname(relativePath));
  let segment = fileName;

  if (GENERIC_DOC_TITLES.has(fileName.toLowerCase())) {
    segment =
      parentSegment && parentSegment !== "." ? parentSegment : "documentation";
  }

  return titleize(segment);
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

function readLastModified(
  frontmatter: Record<string, unknown>,
  fallback: Date
): string {
  return (
    normalizeDate(frontmatter.lastModified) ??
    normalizeDate(frontmatter.last_updated) ??
    normalizeDate(frontmatter.lastUpdated) ??
    fallback.toISOString()
  );
}

function normalizeGroupValue(raw: unknown): string[] {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(raw)) {
    const normalized: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") {
        continue;
      }
      const trimmed = item.trim();
      if (trimmed) {
        normalized.push(trimmed);
      }
    }
    return normalized;
  }
  return [];
}

type RenderedLink = {
  title: string;
  url: string;
  description: string;
};

function renderLink(link: RenderedLink): string {
  return `- [${link.title}](${link.url}): ${link.description}`;
}

function withHash(url: string, anchor: string): string {
  return anchor ? `${url}#${anchor}` : url;
}

function stripFrontmatter(input: string): string {
  return input.replace(FRONTMATTER_PATTERN, "");
}

function cleanHeadingText(input: string): string {
  return input
    .replace(/\s+#+\s*$/, "")
    .replace(MARKDOWN_LINK_PATTERN, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(MARKDOWN_INLINE_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

function resolveTocOptions(
  options: DocsTableOfContentsOptions = {}
): Required<DocsTableOfContentsOptions> {
  const minLevel = options.minLevel ?? DEFAULT_TOC_MIN_LEVEL;
  const maxLevel = options.maxLevel ?? DEFAULT_TOC_MAX_LEVEL;
  if (minLevel > maxLevel) {
    throw new Error(
      `Invalid TOC range: minLevel (${minLevel}) must be less than or equal to maxLevel (${maxLevel}).`
    );
  }
  return { minLevel, maxLevel };
}

function resolveNavigationTocOptions(
  toc: ResolveDocsNavigationConfig["toc"]
): DocsTableOfContentsOptions | false {
  if (toc === false) {
    return false;
  }
  return toc === true || toc === undefined ? {} : toc;
}

function isTocHeadingLevel(level: number): level is 1 | 2 | 3 | 4 | 5 | 6 {
  return level >= 1 && level <= 6;
}

/**
 * Extract a nested table of contents from markdown or MDX content. This helper
 * is framework-neutral and intentionally returns plain JSON so any docs app can
 * render it with its own router and component system.
 */
export function extractDocsTableOfContents(
  content: string,
  page: Pick<SourceDoc, "absoluteUrl" | "urlPath">,
  options?: DocsTableOfContentsOptions
): DocsTableOfContentsItem[] {
  const { minLevel, maxLevel } = resolveTocOptions(options);
  const items: DocsTableOfContentsItem[] = [];
  const stack: DocsTableOfContentsItem[] = [];
  const slugCounts = new Map<string, number>();
  let activeFence: "`" | "~" | null = null;

  for (const line of stripFrontmatter(content).split("\n")) {
    const trimmedLine = line.trim();
    const fenceMatch = trimmedLine.match(FENCE_PATTERN);
    if (fenceMatch) {
      const fenceMarker = fenceMatch[1] ?? "";
      const fenceChar: "`" | "~" = fenceMarker.startsWith("`") ? "`" : "~";
      if (activeFence === fenceChar) {
        activeFence = null;
        continue;
      }
      if (activeFence === null) {
        activeFence = fenceChar;
        continue;
      }
    }

    if (activeFence !== null) {
      continue;
    }

    const headingMatch = HEADING_PATTERN.exec(trimmedLine);
    if (!headingMatch) {
      continue;
    }

    const marker = headingMatch[1];
    const rawTitle = headingMatch[2];
    if (!(marker && rawTitle)) {
      continue;
    }

    const level = marker.length;
    if (!isTocHeadingLevel(level) || level < minLevel || level > maxLevel) {
      continue;
    }

    const title = cleanHeadingText(rawTitle);
    if (!title) {
      continue;
    }

    const slug = slugifyDocsHeading(title);
    const slugCount = slugCounts.get(slug) ?? 0;
    slugCounts.set(slug, slugCount + 1);
    const id = slugCount === 0 ? slug : `${slug}-${slugCount}`;
    const item: DocsTableOfContentsItem = {
      id,
      title,
      level,
      urlPath: page.urlPath,
      urlWithHash: withHash(page.urlPath, id),
      absoluteUrlWithHash: withHash(page.absoluteUrl, id),
      children: [],
    };

    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) {
      stack.pop();
    }

    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(item);
    } else {
      items.push(item);
    }
    stack.push(item);
  }

  return items;
}

function pageToRenderedLink(
  doc: Pick<SourceDoc, "description" | "relativePath" | "title">,
  mounts?: DocsPathMount[]
): RenderedLink {
  const title =
    doc.title && !GENERIC_DOC_TITLES.has(doc.title.toLowerCase())
      ? doc.title
      : titleize(doc.relativePath.split("/").pop() ?? "Documentation");
  const description =
    normalizeDescription(doc.description) ||
    `Reference page for ${title.toLowerCase()}.`;
  return {
    title,
    description,
    url: toMountedMarkdownUrlPath(`${doc.relativePath}.md`, mounts),
  };
}

function resolveCuratedLink(
  link: CuratedLink,
  sourceDocs: Map<string, SourceDoc>,
  mounts?: DocsPathMount[]
): RenderedLink {
  const sourceDoc = sourceDocs.get(link.urlPath);
  const title =
    link.title ??
    (sourceDoc?.title && !GENERIC_DOC_TITLES.has(sourceDoc.title.toLowerCase())
      ? sourceDoc.title
      : titleize(
          link.urlPath.split("/").filter(Boolean).pop() ?? "Documentation"
        ));
  const description =
    link.description ??
    normalizeDescription(sourceDoc?.description ?? "") ??
    `Entry point for ${title} documentation.`;
  return {
    title,
    description: description || `Entry point for ${title} documentation.`,
    url: sourceDoc
      ? toMountedMarkdownUrlPath(`${sourceDoc.relativePath}.md`, mounts)
      : toMarkdownUrlPath(link.urlPath),
  };
}

async function collectFiles(
  rootDir: string,
  extensions: string[]
): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(absolutePath, extensions);
      }
      return extensions.includes(path.extname(entry.name))
        ? [absolutePath]
        : [];
    })
  );
  return files.flat();
}

type LocaleReadOptions = {
  i18n?: DocsI18nConfig;
  locale?: LocaleCode;
  includeFallback?: boolean;
};

function resolveLocaleReadOptions(options: LocaleReadOptions): {
  i18n: ReturnType<typeof normalizeDocsI18nConfig>;
  locale?: LocaleCode;
  includeFallback: boolean;
} {
  const i18n = normalizeDocsI18nConfig(options.i18n);
  if (!i18n) {
    return { i18n, includeFallback: false };
  }
  const locale = options.locale ?? i18n.defaultLocale;
  if (!i18n.locales.some((entry) => entry.code === locale)) {
    throw new Error(`Unknown locale "${locale}" in i18n config.`);
  }
  return {
    i18n,
    locale,
    includeFallback: options.includeFallback ?? i18n.fallback === "default",
  };
}

function assertUnambiguousDefaultLocaleLayout(
  relativePaths: string[],
  localeCodes: Set<string>,
  defaultLocale: string
): void {
  const hasRootDefault = relativePaths.some((relativePath) => {
    const first = normalizeDocsPath(relativePath).split("/")[0] ?? "";
    return !localeCodes.has(first);
  });
  const hasDefaultFolder = relativePaths.some((relativePath) =>
    normalizeDocsPath(relativePath).startsWith(`${defaultLocale}/`)
  );

  if (hasRootDefault && hasDefaultFolder) {
    throw new Error(
      `Ambiguous i18n default-locale layout. Use either root docs files or docs/${defaultLocale}/ files for the default locale, not both.`
    );
  }
}

type SelectedDocFile = LocalizedDocsMetadata & {
  filePath: string;
  logicalPath: string;
  outputRelativePath: string;
  sourceLocale?: LocaleCode;
};

function selectLocalizedFiles(
  files: string[],
  docsDir: string,
  options: {
    defaultLocale: LocaleCode;
    locale: LocaleCode;
    localeCodes: Set<string>;
    includeFallback: boolean;
  }
): SelectedDocFile[] {
  const byLogicalPath = new Map<
    string,
    Map<LocaleCode, { filePath: string; sourceLocale: LocaleCode }>
  >();

  for (const filePath of files) {
    const relativePath = normalizeDocsPath(path.relative(docsDir, filePath));
    const { logicalPath, sourceLocale } = logicalPathFromLocaleRelativePath(
      relativePath,
      options.localeCodes
    );
    const resolvedSourceLocale = sourceLocale ?? options.defaultLocale;
    const localeFiles = byLogicalPath.get(logicalPath) ?? new Map();
    const existing = localeFiles.get(resolvedSourceLocale);
    if (existing) {
      throw new Error(
        `Duplicate docs file for logical path "${logicalPath}" and locale "${resolvedSourceLocale}": "${existing.filePath}" conflicts with "${filePath}". Rename one or remove it.`
      );
    }

    localeFiles.set(resolvedSourceLocale, {
      filePath,
      sourceLocale: resolvedSourceLocale,
    });
    byLogicalPath.set(logicalPath, localeFiles);
  }

  const selected: SelectedDocFile[] = [];
  for (const [logicalPath, localeFiles] of byLogicalPath) {
    const localized = localeFiles.get(options.locale);
    const fallback =
      options.includeFallback && options.locale !== options.defaultLocale
        ? localeFiles.get(options.defaultLocale)
        : undefined;
    const match = localized ?? fallback;
    if (!match) {
      continue;
    }
    selected.push({
      filePath: match.filePath,
      locale: options.locale,
      sourceLocale: match.sourceLocale,
      isFallback: match.sourceLocale !== options.locale,
      logicalPath,
      outputRelativePath: outputRelativePathForLocale(
        logicalPath,
        options.locale,
        {
          defaultLocale: options.defaultLocale,
          locales: Array.from(options.localeCodes),
        }
      ),
    });
  }

  return selected.sort((left, right) =>
    left.outputRelativePath.localeCompare(right.outputRelativePath)
  );
}

async function readSourceDocs(
  srcDir: string,
  baseUrl: string,
  mounts?: DocsPathMount[],
  docsDirName: string = DOCS_DIRNAME,
  localeOptions: LocaleReadOptions = {}
): Promise<Map<string, SourceDocWithContent>> {
  const docsDir = path.join(srcDir, docsDirName);
  const docs = new Map<string, SourceDocWithContent>();

  if (!existsSync(docsDir)) {
    return docs;
  }

  const files = await collectFiles(docsDir, [".md", ".mdx"]);
  const relativePaths = files.map((filePath) =>
    normalizeDocsPath(path.relative(docsDir, filePath))
  );
  const localeRead = resolveLocaleReadOptions(localeOptions);
  const localeCodes = new Set(
    localeRead.i18n?.locales.map((locale) => locale.code) ?? []
  );

  if (localeRead.i18n && localeRead.locale) {
    assertUnambiguousDefaultLocaleLayout(
      relativePaths,
      localeCodes,
      localeRead.i18n.defaultLocale
    );
  }

  const selectedFiles: SelectedDocFile[] =
    localeRead.i18n && localeRead.locale
      ? selectLocalizedFiles(files, docsDir, {
          defaultLocale: localeRead.i18n.defaultLocale,
          locale: localeRead.locale,
          localeCodes,
          includeFallback: localeRead.includeFallback,
        })
      : files.map((filePath) => {
          const relativePath = normalizeDocsPath(
            path.relative(docsDir, filePath)
          );
          return {
            filePath,
            logicalPath: stripDocsExtension(relativePath),
            outputRelativePath: stripDocsExtension(relativePath),
          };
        });

  const entries = await Promise.all(
    selectedFiles.map(async (file) => {
      const relativePath = normalizeDocsPath(
        path.relative(docsDir, file.filePath)
      );
      const raw = await readFile(file.filePath, "utf-8");
      const parsed = parseFrontmatter(raw);
      const title =
        String(parsed.data.title ?? "").trim() ||
        titleFromRelativePath(
          `${file.logicalPath}${path.extname(relativePath)}`,
          path.extname(relativePath) as ".md" | ".mdx"
        ) ||
        "Untitled";
      const description = normalizeDescription(
        String(parsed.data.description ?? "")
      );
      const urlPath =
        localeRead.i18n && localeRead.locale
          ? toLocalizedDocsUrlPath(
              `${file.logicalPath}.mdx`,
              localeRead.locale,
              localeRead.i18n,
              mounts
            )
          : toUrlPath(relativePath, mounts);
      const groups = normalizeGroupValue(parsed.data.group);
      const orderRaw = parsed.data.order;
      const order =
        typeof orderRaw === "number" && Number.isFinite(orderRaw)
          ? orderRaw
          : undefined;
      return {
        urlPath,
        doc: {
          title,
          description,
          urlPath,
          absoluteUrl: toAbsoluteUrl(urlPath, baseUrl),
          relativePath: file.outputRelativePath,
          groups,
          ...(order === undefined ? {} : { order }),
          ...(file.locale ? { locale: file.locale } : {}),
          ...(file.sourceLocale ? { sourceLocale: file.sourceLocale } : {}),
          ...(file.isFallback === undefined
            ? {}
            : { isFallback: file.isFallback }),
          ...(file.logicalPath ? { logicalPath: file.logicalPath } : {}),
          content: parsed.content,
        },
      };
    })
  );

  for (const { urlPath, doc } of entries) {
    const existing = docs.get(urlPath);
    if (existing) {
      throw new Error(
        `Duplicate documentation route "${urlPath}" — both "${existing.relativePath}" and "${doc.relativePath}" normalize to the same path.`
      );
    }
    docs.set(urlPath, doc);
  }

  return docs;
}

async function readMarkdownDocs(
  outDir: string,
  baseUrl: string,
  mounts?: DocsPathMount[],
  localeOptions: LocaleReadOptions = {}
): Promise<MarkdownDoc[]> {
  const docsDir = path.join(outDir, DOCS_DIRNAME);
  if (!existsSync(docsDir)) {
    return [];
  }

  const files = await collectFiles(docsDir, [".md"]);
  const relativePaths = files.map((filePath) =>
    normalizeDocsPath(path.relative(docsDir, filePath))
  );
  const localeRead = resolveLocaleReadOptions(localeOptions);
  const localeCodes = new Set(
    localeRead.i18n?.locales.map((locale) => locale.code) ?? []
  );
  if (localeRead.i18n && localeRead.locale) {
    assertUnambiguousDefaultLocaleLayout(
      relativePaths,
      localeCodes,
      localeRead.i18n.defaultLocale
    );
  }
  const selectedFiles: SelectedDocFile[] =
    localeRead.i18n && localeRead.locale
      ? selectLocalizedFiles(files, docsDir, {
          defaultLocale: localeRead.i18n.defaultLocale,
          locale: localeRead.locale,
          localeCodes,
          includeFallback: localeRead.includeFallback,
        })
      : files.map((filePath) => {
          const relativePath = normalizeDocsPath(
            path.relative(docsDir, filePath)
          );
          return {
            filePath,
            logicalPath: stripDocsExtension(relativePath),
            outputRelativePath: stripDocsExtension(relativePath),
          };
        });
  const docs = await Promise.all(
    selectedFiles.map(async (file) => {
      const relativePath = normalizeDocsPath(
        path.relative(docsDir, file.filePath)
      );
      const raw = await readFile(file.filePath, "utf-8");
      const fileStat = await stat(file.filePath);
      const parsed = parseFrontmatter(raw);
      const title =
        String(parsed.data.title ?? "").trim() ||
        titleFromRelativePath(`${file.logicalPath}.md`, ".md") ||
        "Untitled";
      const description = normalizeDescription(
        String(parsed.data.description ?? "")
      );
      const urlPath =
        localeRead.i18n && localeRead.locale
          ? toLocalizedDocsUrlPath(
              `${file.logicalPath}.md`,
              localeRead.locale,
              localeRead.i18n,
              mounts
            )
          : toUrlPath(relativePath, mounts);
      const groups = normalizeGroupValue(parsed.data.group);
      const orderRaw = parsed.data.order;
      const order =
        typeof orderRaw === "number" && Number.isFinite(orderRaw)
          ? orderRaw
          : undefined;

      return {
        title,
        description,
        urlPath,
        absoluteUrl: toAbsoluteUrl(urlPath, baseUrl),
        relativePath: file.outputRelativePath,
        groups,
        ...(order === undefined ? {} : { order }),
        ...(file.locale ? { locale: file.locale } : {}),
        ...(file.sourceLocale ? { sourceLocale: file.sourceLocale } : {}),
        ...(file.isFallback === undefined
          ? {}
          : { isFallback: file.isFallback }),
        ...(file.logicalPath ? { logicalPath: file.logicalPath } : {}),
        content: parsed.content.trim(),
        lastModified: readLastModified(parsed.data, fileStat.mtime),
      };
    })
  );

  return docs
    .filter((doc) => {
      const filename = path.basename(`${doc.relativePath}.md`);
      return !(
        GENERATED_MARKDOWN_FILES.has(`${doc.relativePath}.md`) ||
        GENERATED_MARKDOWN_FILES.has(filename)
      );
    })
    .sort((left, right) => left.urlPath.localeCompare(right.urlPath));
}

type GroupMembership = {
  /** Map from group slug (lowercased) → pages whose `group:` lists that slug. */
  byGroupSlug: Map<string, SourceDoc[]>;
  /** Pages whose frontmatter has no `group:`. */
  ungrouped: SourceDoc[];
  /** Pages that named a group slug not present in the config. */
  unknown: { page: SourceDoc; slug: string }[];
};

function buildGroupMembership(
  pages: SourceDoc[],
  resolved: ResolvedGroup[]
): GroupMembership {
  const all = flattenGroups(resolved);
  const known = new Map(all.map((g) => [g.slugKey, g]));
  const byGroupSlug = new Map<string, SourceDoc[]>();
  const ungrouped: SourceDoc[] = [];
  const unknown: { page: SourceDoc; slug: string }[] = [];

  // Page order within a group:
  //   1. Pages with an explicit `order:` field sort first, ascending.
  //   2. Pages without `order` sort alphabetically by urlPath as a tiebreaker.
  // This lets authors pin a few key pages with `order: 10, 20, 30, …` and
  // leave the rest at the default. Sorting is stable and deterministic so
  // the rendered llms.txt, sidebar, and AGENTS.md match across runs.
  const ordered = [...pages].sort((left, right) => {
    const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
    const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.urlPath.localeCompare(right.urlPath);
  });

  for (const page of ordered) {
    if (page.groups.length === 0) {
      ungrouped.push(page);
      continue;
    }
    let matchedAny = false;
    for (const slug of page.groups) {
      const slugKey = slug.toLowerCase();
      if (!known.has(slugKey)) {
        unknown.push({ page, slug });
        continue;
      }
      const list = byGroupSlug.get(slugKey) ?? [];
      list.push(page);
      byGroupSlug.set(slugKey, list);
      matchedAny = true;
    }
    if (!matchedAny) {
      ungrouped.push(page);
    }
  }

  return { byGroupSlug, ungrouped, unknown };
}

function isNavIncludeEntry(
  entry: DocsNavPageEntry
): entry is DocsNavIncludeEntry {
  return typeof entry === "object" && entry !== null;
}

function createDocsByRelativePath(docs: SourceDoc[]): Map<string, SourceDoc> {
  const byPath = new Map<string, SourceDoc>();
  for (const doc of docs) {
    const key = normalizeNavPath(doc.relativePath);
    byPath.set(key, doc);
    if (key === "") {
      byPath.set("index", doc);
    }
    if (key.endsWith("/index")) {
      byPath.set(key.slice(0, -"/index".length), doc);
    }
    if (key === "index") {
      byPath.set("", doc);
    }
  }
  return byPath;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeNavPath(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      const after = normalized[index + 2];
      if (after === "/") {
        source += "(?:[^/]+/)*";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char ?? "");
    }
  }
  return new RegExp(`^${source}$`);
}

function compareNavDocs(
  left: SourceDoc,
  right: SourceDoc,
  sort: readonly DocsNavSortKey[]
): number {
  for (const key of sort) {
    if (key === "order") {
      const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
      const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
    } else if (key === "title") {
      const compared = left.title.localeCompare(right.title);
      if (compared !== 0) {
        return compared;
      }
    } else {
      const compared = left.relativePath.localeCompare(right.relativePath);
      if (compared !== 0) {
        return compared;
      }
    }
  }
  return left.relativePath.localeCompare(right.relativePath);
}

function normalizeExcludePatterns(
  exclude: string | string[] | undefined,
  base: string
) {
  let patterns: string[] = [];
  if (typeof exclude === "string") {
    patterns = [exclude];
  } else if (Array.isArray(exclude)) {
    patterns = exclude;
  }
  return patterns.map((pattern) => globToRegExp(joinNavPath(base, pattern)));
}

/**
 * resolveNavEntryPages is intentionally asymmetric: entries that fail
 * isNavIncludeEntry are string refs and throw when docsByRelativePath has no
 * matching page, while entry.include globs only warn unless entry.required is
 * true.
 */
function resolveNavEntryPages(
  group: ResolvedGroup,
  entry: DocsNavPageEntry,
  docs: SourceDoc[],
  docsByRelativePath: Map<string, SourceDoc>
): SourceDoc[] {
  if (!isNavIncludeEntry(entry)) {
    const ref = joinNavPath(group.base, entry);
    const doc = docsByRelativePath.get(ref);
    if (!doc) {
      const scope = group.segmentPath.join("/") || "root";
      throw new Error(
        `Nav page "${entry}" under "${scope}" did not match a documentation page.`
      );
    }
    return [doc];
  }

  const include = joinNavPath(group.base, entry.include);
  const includePattern = globToRegExp(include);
  const excludePatterns = normalizeExcludePatterns(entry.exclude, group.base);
  const sort = entry.sort ?? NAV_INCLUDE_SORT_DEFAULT;
  const matches = docs
    .filter((doc) => {
      const relativePath = normalizeNavPath(doc.relativePath);
      return (
        includePattern.test(relativePath) &&
        !excludePatterns.some((pattern) => pattern.test(relativePath))
      );
    })
    .sort((left, right) => compareNavDocs(left, right, sort));

  if (matches.length === 0) {
    const scope = group.segmentPath.join("/") || "root";
    const message = `Nav include "${entry.include}" under "${scope}" matched no documentation pages.`;
    if (entry.required) {
      throw new Error(message);
    }
    logger.warn({
      human: { message },
      json: {
        event: "nav.include.empty",
        fields: { include: entry.include, group: group.segmentPath.join("/") },
      },
    });
  }

  return matches;
}

/** Pages whose `group:` includes the slug of `target` or any descendant. */
function pagesUnderGroup(
  target: ResolvedGroup,
  membership: GroupMembership
): SourceDoc[] {
  const seen = new Set<string>();
  const collected: SourceDoc[] = [];
  const stack = [target, ...flattenGroups(target.children)];
  for (const group of stack) {
    const list = membership.byGroupSlug.get(group.slugKey) ?? [];
    for (const page of list) {
      if (seen.has(page.urlPath)) {
        continue;
      }
      seen.add(page.urlPath);
      collected.push(page);
    }
  }
  return collected;
}

/**
 * Resolve the ordered content blocks for a product. When `blocks` is set it is
 * used as-is; otherwise the deprecated `bullets` / `bestStartingPoints` /
 * `agentGuidance` fields are synthesized into the equivalent block sequence so
 * existing configs emit byte-for-byte identical output.
 */
function resolveBlocks(product: LlmsProductInfo): LlmsBlock[] {
  if (product.blocks) {
    return product.blocks;
  }
  const blocks: LlmsBlock[] = [];
  if (product.bullets && product.bullets.length > 0) {
    blocks.push({
      type: "markdown",
      heading: "Product Summary",
      body: product.bullets.map((bullet) => `- ${bullet}`).join("\n"),
    });
  }
  if (product.bestStartingPoints && product.bestStartingPoints.length > 0) {
    blocks.push({
      type: "links",
      heading: "Best Starting Points",
      links: product.bestStartingPoints,
    });
  }
  if (product.agentGuidance) {
    blocks.push({
      type: "markdown",
      heading: "Agent Guidance",
      body: product.agentGuidance,
    });
  }
  return blocks;
}

/** Render one block for the website `llms.txt` (absolute markdown URL paths). */
function renderProductBlock(
  block: LlmsBlock,
  sourceDocs: Map<string, SourceDoc>,
  mounts?: DocsPathMount[]
): string[] {
  if (block.type === "links") {
    const links = block.links.map((link) =>
      resolveCuratedLink(link, sourceDocs, mounts)
    );
    if (links.length === 0) {
      return [];
    }
    return ["", `## ${block.heading}`, "", ...links.map(renderLink)];
  }
  if (block.heading) {
    return ["", `## ${block.heading}`, "", block.body];
  }
  return ["", block.body];
}

function renderProductSummary(
  product: LlmsProductInfo,
  sourceDocs: Map<string, SourceDoc>,
  mounts?: DocsPathMount[]
): string {
  const sections: string[] = [`# ${product.name}`, "", `> ${product.summary}`];
  for (const block of resolveBlocks(product)) {
    sections.push(...renderProductBlock(block, sourceDocs, mounts));
  }
  return sections.join("\n");
}

function renderDocsSummary(
  product: LlmsProductInfo,
  resolved: ResolvedGroup[],
  membership: GroupMembership,
  mounts?: DocsPathMount[]
): string {
  const renderedSections: string[] = [];
  for (const group of resolved) {
    const pages = pagesUnderGroup(group, membership);
    if (pages.length === 0) {
      continue;
    }
    const lines: string[] = [`## ${group.title}`];
    if (group.description) {
      lines.push("", group.description);
    }
    lines.push(
      "",
      ...pages.map((page) => pageToRenderedLink(page, mounts)).map(renderLink)
    );
    renderedSections.push(lines.join("\n"));
  }

  if (membership.ungrouped.length > 0) {
    const lines = ["## Other"];
    lines.push(
      "",
      ...membership.ungrouped
        .map((page) => pageToRenderedLink(page, mounts))
        .map(renderLink)
    );
    renderedSections.push(lines.join("\n"));
  }

  return `# ${product.name} Documentation

> Curated documentation map for developers and coding agents working with ${product.name}.

## How To Use This File

Read the summary links first. If the page links are not enough, use \`/llms-full.txt\` as the broad full-context fallback.

${renderedSections.join("\n\n")}`;
}

function renderNavigationSummaryGroup(
  group: DocsNavigationGroup,
  mounts: DocsPathMount[] | undefined,
  depth = 2,
  // Children flagged `optional` at any depth collapse into the trailing
  // `## Optional` section rather than rendering inline. Their pages accumulate
  // here so the caller can render them once.
  optionalPages?: DocsNavigationPage[]
): string[] {
  const lines: string[] = [`${"#".repeat(depth)} ${group.title}`];
  if (group.description) {
    lines.push("", group.description);
  }

  if (group.pages.length > 0) {
    lines.push(
      "",
      ...group.pages
        .map((page) => pageToRenderedLink(page, mounts))
        .map(renderLink)
    );
  }

  for (const child of group.children) {
    if (child.optional && optionalPages) {
      optionalPages.push(...collectNavigationGroupPages(child));
      continue;
    }
    lines.push(
      "",
      ...renderNavigationSummaryGroup(child, mounts, depth + 1, optionalPages)
    );
  }

  return lines;
}

function collectNavigationGroupPages(
  group: DocsNavigationGroup
): DocsNavigationPage[] {
  const pages = [...group.pages];
  for (const child of group.children) {
    pages.push(...collectNavigationGroupPages(child));
  }
  return pages;
}

function renderDocsNavigationSummary(
  product: LlmsProductInfo,
  navigation: DocsNavigation,
  mounts?: DocsPathMount[]
): string {
  const renderedSections: string[] = [];
  const optionalPages: DocsNavigationPage[] = [];
  for (const group of navigation.groups) {
    // Sections flagged `optional` collapse into a single trailing `## Optional`
    // section (the llms.txt convention for links safe to drop for shorter context).
    if (group.optional) {
      optionalPages.push(...collectNavigationGroupPages(group));
      continue;
    }
    renderedSections.push(
      renderNavigationSummaryGroup(group, mounts, 2, optionalPages).join("\n")
    );
  }

  if (navigation.ungrouped.length > 0) {
    const lines = ["## Other"];
    lines.push(
      "",
      ...navigation.ungrouped
        .map((page) => pageToRenderedLink(page, mounts))
        .map(renderLink)
    );
    renderedSections.push(lines.join("\n"));
  }

  if (optionalPages.length > 0) {
    const seen = new Set<string>();
    const lines = [
      "## Optional",
      "",
      "Lower-priority pages — safe to skip for a shorter context.",
      "",
      ...optionalPages
        .filter((page) => {
          if (seen.has(page.urlPath)) {
            return false;
          }
          seen.add(page.urlPath);
          return true;
        })
        .map((page) => pageToRenderedLink(page, mounts))
        .map(renderLink),
    ];
    renderedSections.push(lines.join("\n"));
  }

  return `# ${product.name} Documentation

> Curated documentation map for developers and coding agents working with ${product.name}.

## How To Use This File

Read the summary links first. If the page links are not enough, use \`/llms-full.txt\` as the broad full-context fallback.

${renderedSections.join("\n\n")}`;
}

const LEADING_H1_PATTERN = /^[ \t]*#[ \t]+\S/;

// We prepend our own `# ${title}` per page; strip any leading H1 from the
// source markdown to avoid duplicate H1s when the source's title differs from
// frontmatter (whitespace, decorators, mismatch).
function stripLeadingTitleHeading(content: string): string {
  const lines = content.split("\n");
  let cursor = 0;
  while (cursor < lines.length && (lines[cursor] ?? "").trim() === "") {
    cursor++;
  }
  if (cursor < lines.length && LEADING_H1_PATTERN.test(lines[cursor] ?? "")) {
    return lines
      .slice(cursor + 1)
      .join("\n")
      .trimStart();
  }
  return content;
}

function renderFullContextDocument(
  product: Pick<LlmsProductInfo, "name">,
  pages: MarkdownDoc[]
): string {
  const links = pages.map((doc) => ({
    title: doc.title,
    url: doc.absoluteUrl,
    description:
      doc.description || `Entry point for ${doc.title} documentation.`,
  }));
  const contentBlocks = pages.map((doc) => {
    const description = doc.description ? `${doc.description}\n` : "";
    const content = stripLeadingTitleHeading(doc.content);
    return `# ${doc.title}
URL: ${doc.absoluteUrl}
${description}
${content}`.trim();
  });

  return [
    `# ${product.name} Full Context`,
    "",
    "> All generated markdown documentation pages flattened into one file.",
    "",
    "## Included Pages",
    "",
    links.length > 0
      ? links.map(renderLink).join("\n")
      : "_No generated documentation pages were found._",
    "",
    "## Content",
    "",
    contentBlocks.join("\n\n"),
  ].join("\n");
}

function flattenNavigationPagePaths(navigation: DocsNavigation): string[] {
  const paths: string[] = [];
  const visit = (group: DocsNavigationGroup) => {
    for (const page of group.pages) {
      paths.push(page.urlPath);
    }
    for (const child of group.children) {
      visit(child);
    }
  };
  for (const group of navigation.groups) {
    visit(group);
  }
  for (const page of navigation.ungrouped) {
    paths.push(page.urlPath);
  }
  return paths;
}

function orderMarkdownDocsByNavigation(
  docs: MarkdownDoc[],
  navigation: DocsNavigation
): MarkdownDoc[] {
  const byUrlPath = new Map(docs.map((doc) => [doc.urlPath, doc]));
  const seen = new Set<string>();
  const ordered: MarkdownDoc[] = [];
  for (const urlPath of flattenNavigationPagePaths(navigation)) {
    const doc = byUrlPath.get(urlPath);
    if (doc && !seen.has(urlPath)) {
      ordered.push(doc);
      seen.add(urlPath);
    }
  }
  for (const doc of docs) {
    if (!seen.has(doc.urlPath)) {
      ordered.push(doc);
    }
  }
  return ordered;
}

/**
 * Generate `/llms.txt` (product summary) and `/docs/llms.txt` (curated docs
 * map) by reading frontmatter from .md/.mdx files under `{srcDir}/docs/`.
 */
export async function generateLlmsTxt(config: LlmsTxtConfig): Promise<void> {
  const srcDir = path.resolve(config.srcDir);
  const outDir = path.resolve(config.outDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const i18n = normalizeDocsI18nConfig(config.i18n);
  const locale = config.locale ?? i18n?.defaultLocale;
  const sourceDocs = await readSourceDocs(
    srcDir,
    baseUrl,
    config.mounts,
    DOCS_DIRNAME,
    {
      i18n: config.i18n,
      locale,
      includeFallback: false,
    }
  );

  const sourceDocList = [...sourceDocs.values()];
  const hasNav = Boolean(config.nav && config.nav.length > 0);
  const resolvedNav = hasNav ? resolveNavConfig(config.nav ?? []) : undefined;
  const resolved = hasNav
    ? (resolvedNav?.groups ?? [])
    : resolveGroups(config.groups ?? []);
  const membership = hasNav
    ? undefined
    : buildGroupMembership(sourceDocList, resolved);

  await mkdir(path.join(outDir, DOCS_DIRNAME), { recursive: true });
  const isDefaultLocale = !i18n || locale === i18n.defaultLocale;
  if (isDefaultLocale) {
    const outputPath = path.join(outDir, "llms.txt");
    const input: DocsLlmsTxtArtifact = {
      content: renderProductSummary(config.product, sourceDocs, config.mounts),
      outputPath,
      kind: "root",
      ...(locale ? { locale } : {}),
    };
    const artifact = await runTransformers(
      config.transformers,
      "beforeLlmsTxt",
      input,
      { stage: "llm", relativePath: "llms.txt", locale },
      (transformer, value, context) =>
        transformer.beforeLlmsTxt?.(value, context)
    );
    await writeFile(outputPath, artifact.content);
    // Publish a discovery copy at the well-known location so agents can find
    // llms.txt without guessing the root path. Served statically from the
    // output (public) dir; no route handler needed.
    const wellKnownPath = path.join(outDir, ".well-known", "llms.txt");
    await mkdir(path.dirname(wellKnownPath), { recursive: true });
    await writeFile(wellKnownPath, artifact.content);
  }

  if (hasNav || resolved.length > 0) {
    const docsLlmsPath =
      i18n && locale && locale !== i18n.defaultLocale
        ? path.join(outDir, DOCS_DIRNAME, locale, "llms.txt")
        : path.join(outDir, DOCS_DIRNAME, "llms.txt");
    await mkdir(path.dirname(docsLlmsPath), { recursive: true });
    const docsLlmsContent = hasNav
      ? renderDocsNavigationSummary(
          config.product,
          buildNavigationFromNav(
            sourceDocList,
            resolved,
            new Map(),
            locale,
            [],
            resolvedNav?.rootPageEntries ?? []
          ),
          config.mounts
        )
      : renderDocsSummary(
          config.product,
          resolved,
          membership ?? {
            byGroupSlug: new Map(),
            unknown: [],
            ungrouped: [],
          },
          config.mounts
        );
    const docsLlmsRelativePath =
      i18n && locale && locale !== i18n.defaultLocale
        ? `docs/${locale}/llms.txt`
        : "docs/llms.txt";
    const input: DocsLlmsTxtArtifact = {
      content: docsLlmsContent,
      outputPath: docsLlmsPath,
      kind: "docs",
      ...(locale ? { locale } : {}),
    };
    const artifact = await runTransformers(
      config.transformers,
      "beforeLlmsTxt",
      input,
      { stage: "llm", relativePath: docsLlmsRelativePath, locale },
      (transformer, value, context) =>
        transformer.beforeLlmsTxt?.(value, context)
    );
    await writeFile(docsLlmsPath, artifact.content);
  }
}

/**
 * Generate the root `/llms-full.txt` full-context file. Reads generated .md
 * files from `{outDir}/docs/`.
 */
export async function generateLLMFullContextFiles(
  config: LLMFullContextConfig
): Promise<void> {
  const outDir = path.resolve(config.outDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const i18n = normalizeDocsI18nConfig(config.i18n);
  const locale = config.locale ?? i18n?.defaultLocale;
  const markdownDocs = await readMarkdownDocs(outDir, baseUrl, config.mounts, {
    i18n: config.i18n,
    locale,
    includeFallback: false,
  });

  if (markdownDocs.length === 0) {
    throw new Error(
      `generateLLMFullContextFiles found no markdown under "${path.join(outDir, DOCS_DIRNAME)}". Run convertAllMdx first, or check that config.outDir matches.`
    );
  }

  let orderedMarkdownDocs = markdownDocs;
  if (config.nav && config.nav.length > 0) {
    const resolvedNav = resolveNavConfig(config.nav);
    const navigation = buildNavigationFromMarkdownDocs(
      markdownDocs,
      resolvedNav.groups,
      "nav",
      undefined,
      resolvedNav.rootPageEntries
    );
    orderedMarkdownDocs = orderMarkdownDocsByNavigation(
      markdownDocs,
      navigation
    );
  } else {
    resolveGroups(config.groups ?? []);
  }

  if (!i18n || locale === i18n.defaultLocale) {
    const llmsFullDir = path.join(outDir, DOCS_DIRNAME, "llms-full");
    const outputPath = path.join(outDir, "llms-full.txt");
    await rm(llmsFullDir, { recursive: true, force: true });
    await rm(path.join(outDir, DOCS_DIRNAME, "llms-full.txt"), { force: true });
    const artifact = await runTransformers(
      config.transformers,
      "beforeLlmsFull",
      {
        content: renderFullContextDocument(config.product, orderedMarkdownDocs),
        outputPath,
        ...(locale ? { locale } : {}),
      },
      { stage: "llm", relativePath: "llms-full.txt", locale },
      (transformer, value, context) =>
        transformer.beforeLlmsFull?.(value, context)
    );
    await writeFile(outputPath, artifact.content);
    // Discovery copy at the well-known location, alongside .well-known/llms.txt.
    const wellKnownFull = path.join(outDir, ".well-known", "llms-full.txt");
    await mkdir(path.dirname(wellKnownFull), { recursive: true });
    await writeFile(wellKnownFull, artifact.content);
    return;
  }

  const localeFullPath = path.join(
    outDir,
    DOCS_DIRNAME,
    locale ?? i18n.defaultLocale,
    "llms-full.txt"
  );
  await mkdir(path.dirname(localeFullPath), { recursive: true });
  const artifact = await runTransformers(
    config.transformers,
    "beforeLlmsFull",
    {
      content: renderFullContextDocument(config.product, orderedMarkdownDocs),
      outputPath: localeFullPath,
      ...(locale ? { locale } : {}),
    },
    { stage: "llm", relativePath: `docs/${locale}/llms-full.txt`, locale },
    (transformer, value, context) =>
      transformer.beforeLlmsFull?.(value, context)
  );
  await writeFile(localeFullPath, artifact.content);
}

function toAgentReadabilityPage(
  doc: MarkdownDoc,
  baseUrl: string,
  mounts?: DocsPathMount[]
): AgentReadabilityPage {
  const markdownUrlPath = toMountedMarkdownUrlPath(
    `${doc.relativePath}.md`,
    mounts
  );
  return {
    title: doc.title,
    description: doc.description,
    urlPath: doc.urlPath,
    absoluteUrl: doc.absoluteUrl,
    markdownUrlPath,
    markdownAbsoluteUrl: toAbsoluteUrl(markdownUrlPath, baseUrl),
    relativePath: doc.relativePath,
    groups: [...doc.groups],
    lastModified: doc.lastModified,
    ...(doc.locale ? { locale: doc.locale } : {}),
    ...(doc.sourceLocale ? { sourceLocale: doc.sourceLocale } : {}),
    ...(doc.isFallback === undefined ? {} : { isFallback: doc.isFallback }),
    ...(doc.logicalPath ? { logicalPath: doc.logicalPath } : {}),
  };
}

function buildNavigationFromMarkdownDocs(
  docs: MarkdownDoc[],
  resolved: ResolvedGroup[],
  mode: "groups" | "nav" = "groups",
  groupsForValidation?: DocsGroup[],
  rootPageEntries: DocsNavPageEntry[] = []
): DocsNavigation {
  const tocByUrlPath = new Map(
    docs.map((doc) => [
      doc.urlPath,
      extractDocsTableOfContents(doc.content, doc),
    ])
  );
  if (mode === "nav") {
    return buildNavigationFromNav(
      docs,
      resolved,
      tocByUrlPath,
      docs[0]?.locale,
      findUnknownGroups(docs, groupsForValidation),
      rootPageEntries
    );
  }

  const membership = buildGroupMembership(docs, resolved);
  return {
    groups: resolved.map((group) =>
      buildNavigationGroup(group, membership, tocByUrlPath)
    ),
    ungrouped: membership.ungrouped.map((page) => pageView(page, tocByUrlPath)),
    unknown: membership.unknown.map(({ page, slug }) => ({
      urlPath: page.urlPath,
      slug,
    })),
    locale: docs[0]?.locale,
  };
}

/**
 * Generate docs-scoped Vercel Agent Readability discovery artifacts. These
 * files are intentionally written under `/docs/` so host apps can merge them
 * with blog, marketing, changelog, or product pages before serving root-level
 * `/sitemap.xml`, `/sitemap.md`, and `/robots.txt`.
 */
export async function generateAgentReadabilityArtifacts(
  config: AgentReadabilityConfig
): Promise<AgentReadabilityResult> {
  const outDir = path.resolve(config.outDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const i18n = normalizeDocsI18nConfig(config.i18n);
  const locale = config.locale ?? i18n?.defaultLocale;
  const docsDir =
    i18n && locale && locale !== i18n.defaultLocale
      ? path.join(outDir, DOCS_DIRNAME, locale)
      : path.join(outDir, DOCS_DIRNAME);
  const docsUrlPrefix =
    i18n && locale && locale !== i18n.defaultLocale
      ? `/docs/${locale}`
      : "/docs";
  const markdownDocs = await readMarkdownDocs(outDir, baseUrl, config.mounts, {
    i18n: config.i18n,
    locale,
    includeFallback: false,
  });

  if (markdownDocs.length === 0) {
    throw new Error(
      `generateAgentReadabilityArtifacts found no markdown under "${docsDir}". Run convertAllMdx first, or check that config.outDir matches.`
    );
  }

  const hasNav = Boolean(config.nav && config.nav.length > 0);
  const resolvedNav = hasNav ? resolveNavConfig(config.nav ?? []) : undefined;
  const resolved = hasNav
    ? (resolvedNav?.groups ?? [])
    : resolveGroups(config.groups ?? []);
  const navigation = buildNavigationFromMarkdownDocs(
    markdownDocs,
    resolved,
    hasNav ? "nav" : "groups",
    config.groups,
    resolvedNav?.rootPageEntries ?? []
  );
  const pages = markdownDocs.map((doc) =>
    toAgentReadabilityPage(doc, baseUrl, config.mounts)
  );
  const manifest: AgentReadabilityManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    baseUrl,
    product: config.product,
    ...(locale ? { locale } : {}),
    ...(config.i18nManifest ? { i18n: config.i18nManifest } : {}),
    pages,
    navigation,
    files: {
      robotsTxt: `${docsUrlPrefix}/${ROBOTS_FILE}`,
      sitemapMd: `${docsUrlPrefix}/${SITEMAP_MARKDOWN_FILE}`,
      sitemapXml: `${docsUrlPrefix}/${SITEMAP_XML_FILE}`,
    },
    ...(config.jsonLd ? { jsonLd: config.jsonLd } : {}),
    ...(config.seo ? { seo: config.seo } : {}),
  };

  const files = {
    manifest: path.join(docsDir, AGENT_READABILITY_MANIFEST_FILE),
    robotsTxt: path.join(docsDir, ROBOTS_FILE),
    sitemapMd: path.join(docsDir, SITEMAP_MARKDOWN_FILE),
    sitemapXml: path.join(docsDir, SITEMAP_XML_FILE),
  };

  await mkdir(docsDir, { recursive: true });
  await writeFile(files.sitemapXml, renderSitemapXml(pages));
  await writeFile(
    files.sitemapMd,
    renderSitemapMarkdown({
      product: config.product,
      navigation,
      pages,
    })
  );
  await writeFile(
    files.robotsTxt,
    renderRobotsTxt({
      baseUrl,
      sitemapUrlPath: `${docsUrlPrefix}/sitemap.xml`,
      policy: config.robotsPolicy,
      signals: config.contentSignals,
    })
  );
  await writeFile(files.manifest, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    files,
    manifest,
  };
}

/* ---------------- AGENTS.md (offline package bundle) -------------------- */

export type AgentsMdConfig = {
  /** Repo root containing the `docs/` source. */
  srcDir: string;
  /** Output root. AGENTS.md is written at `<outDir>/AGENTS.md`. */
  outDir: string;
  product: LlmsProductInfo;
  /** Group tree from `docs.config.ts`. Drives section structure. */
  groups?: DocsGroup[];
  /** Curated navigation tree. Preferred over `groups` when present. */
  nav?: DocsNavEntry[];
  /**
   * Subdirectory under `outDir` that holds the converted `.md` files.
   * Used for the relative-path prefix in every link. Default: `docs`.
   */
  docsSubdir?: string;
  i18n?: DocsI18nConfig;
  locale?: LocaleCode;
  transformers?: DocsTransformer[];
};

export type AgentsMdResult = {
  outputPath: string;
};

function relativeDocLink(relativePath: string, docsSubdir: string): string {
  return `./${docsSubdir}/${relativePath}.md`;
}

function pageDescription(
  doc: Pick<SourceDoc, "description" | "title">,
  fallback?: string
): string {
  return (
    normalizeDescription(doc.description) ||
    fallback ||
    `Reference page for ${doc.title.toLowerCase()}.`
  );
}

/**
 * Render one product block for the offline `AGENTS.md` bundle. Link blocks use
 * relative filesystem paths (`./docs/<slug>.md`) and skip links not present in
 * the source, mirroring the legacy `bestStartingPoints` behavior.
 */
function renderAgentsBlock(
  block: LlmsBlock,
  sourceDocs: Map<string, SourceDoc>,
  docsSubdir: string
): string[] {
  if (block.type === "links") {
    const rendered: string[] = [];
    for (const link of block.links) {
      const sourceDoc = sourceDocs.get(link.urlPath);
      if (!sourceDoc) {
        continue;
      }
      const title = link.title ?? sourceDoc.title;
      const description = link.description ?? pageDescription(sourceDoc);
      rendered.push(
        `- [${title}](${relativeDocLink(sourceDoc.relativePath, docsSubdir)}): ${description}`
      );
    }
    if (rendered.length === 0) {
      return [];
    }
    return ["", `## ${block.heading}`, "", ...rendered];
  }
  if (block.heading) {
    return ["", `## ${block.heading}`, "", block.body];
  }
  return ["", block.body];
}

function renderAgentsNavigationGroup(
  group: DocsNavigationGroup,
  docsByUrlPath: Map<string, SourceDoc>,
  docsSubdir: string,
  depth = 2
): string[] {
  const lines: string[] = [`${"#".repeat(depth)} ${group.title}`];
  if (group.description) {
    lines.push("", group.description);
  }
  if (group.pages.length > 0) {
    lines.push("");
    for (const page of group.pages) {
      const sourceDoc = docsByUrlPath.get(page.urlPath) ?? page;
      lines.push(
        `- [${page.title}](${relativeDocLink(page.relativePath, docsSubdir)}): ${pageDescription(sourceDoc)}`
      );
    }
  }
  for (const child of group.children) {
    lines.push(
      "",
      ...renderAgentsNavigationGroup(
        child,
        docsByUrlPath,
        docsSubdir,
        depth + 1
      )
    );
  }
  return lines;
}

/**
 * Generate `AGENTS.md` at the package root for offline-readable docs. Unlike
 * `generateLlmsTxt`, every link is a **relative** filesystem path
 * (`./docs/<segment>/<slug>.md`) so the file works inside a published npm
 * tarball at `node_modules/<pkg>/AGENTS.md`.
 */
export async function generateAgentsMd(
  config: AgentsMdConfig
): Promise<AgentsMdResult> {
  const srcDir = path.resolve(config.srcDir);
  const outDir = path.resolve(config.outDir);
  const docsSubdir = config.docsSubdir ?? DOCS_DIRNAME;
  // baseUrl is required by readSourceDocs for the SourceDoc.absoluteUrl
  // field, but AGENTS.md output never reads that field — relative paths only.
  // Pass through any configured fallback so SourceDoc objects are well-formed.
  const baseUrl = normalizeBaseUrl(undefined);
  const sourceDocs = await readSourceDocs(
    srcDir,
    baseUrl,
    undefined,
    DOCS_DIRNAME,
    {
      i18n: config.i18n,
      locale: config.locale,
      includeFallback: false,
    }
  );
  const sourceDocList = [...sourceDocs.values()];
  const hasNav = Boolean(config.nav && config.nav.length > 0);
  const resolvedNav = hasNav ? resolveNavConfig(config.nav ?? []) : undefined;
  const resolved = hasNav
    ? (resolvedNav?.groups ?? [])
    : resolveGroups(config.groups ?? []);
  const membership = hasNav
    ? undefined
    : buildGroupMembership(sourceDocList, resolved);

  const lines: string[] = [
    `# ${config.product.name}`,
    "",
    `> ${config.product.summary}`,
    "",
    "These docs ship inside the package so coding agents can read them offline. Open the topic file you need from the list below — paths are relative to this file.",
  ];

  if (config.product.blocks) {
    // Author-curated blocks: render each (markdown + resolved link lists) in
    // order. Unlike the legacy path below, an explicit Agent Guidance block is
    // honored — the author opted into the bundle content.
    for (const block of config.product.blocks) {
      lines.push(...renderAgentsBlock(block, sourceDocs, docsSubdir));
    }
  } else {
    if (config.product.bullets && config.product.bullets.length > 0) {
      lines.push("", "## Product Summary", "");
      for (const bullet of config.product.bullets) {
        lines.push(`- ${bullet}`);
      }
    }

    const startingPoints = config.product.bestStartingPoints ?? [];
    const renderedStarts: string[] = [];
    for (const link of startingPoints) {
      const sourceDoc = sourceDocs.get(link.urlPath);
      if (!sourceDoc) {
        // bestStartingPoints can reference URLs not present in source (e.g.
        // /docs root). Skip those rather than emit a broken relative link.
        continue;
      }
      const title = link.title ?? sourceDoc.title;
      const description = link.description ?? pageDescription(sourceDoc);
      renderedStarts.push(
        `- [${title}](${relativeDocLink(sourceDoc.relativePath, docsSubdir)}): ${description}`
      );
    }
    if (renderedStarts.length > 0) {
      lines.push("", "## Best Starting Points", "", ...renderedStarts);
    }
  }

  if (hasNav) {
    const docsByUrlPath = new Map(
      sourceDocList.map((doc) => [doc.urlPath, doc])
    );
    const navigation = buildNavigationFromNav(
      sourceDocList,
      resolved,
      new Map(),
      config.locale,
      [],
      resolvedNav?.rootPageEntries ?? []
    );
    for (const group of navigation.groups) {
      lines.push(
        "",
        ...renderAgentsNavigationGroup(group, docsByUrlPath, docsSubdir)
      );
    }
    if (navigation.ungrouped.length > 0) {
      lines.push("", "## Other", "");
      for (const page of navigation.ungrouped) {
        lines.push(
          `- [${page.title}](${relativeDocLink(page.relativePath, docsSubdir)}): ${pageDescription(page)}`
        );
      }
    }
  } else if (membership) {
    for (const group of resolved) {
      const pages = pagesUnderGroup(group, membership);
      if (pages.length === 0) {
        continue;
      }
      lines.push("", `## ${group.title}`);
      if (group.description) {
        lines.push("", group.description);
      }
      lines.push("");
      for (const page of pages) {
        lines.push(
          `- [${page.title}](${relativeDocLink(page.relativePath, docsSubdir)}): ${pageDescription(page)}`
        );
      }
    }

    if (membership.ungrouped.length > 0) {
      lines.push("", "## Other", "");
      for (const page of membership.ungrouped) {
        lines.push(
          `- [${page.title}](${relativeDocLink(page.relativePath, docsSubdir)}): ${pageDescription(page)}`
        );
      }
    }
  }

  // Legacy path only: skip product.agentGuidance — it's written for the
  // website's llms.txt routing flow ("open /docs/llms.txt then…") and would
  // mislead an agent reading from node_modules. The preamble paragraph already
  // covers offline navigation. Author-curated `blocks` are honored above.

  const content = `${lines.join("\n")}\n`;
  await mkdir(outDir, { recursive: true });
  const outputPath = path.join(outDir, "AGENTS.md");
  const artifact = await runTransformers(
    config.transformers,
    "beforeAgentsMd",
    {
      content,
      outputPath,
      docsSubdir,
      ...(config.locale ? { locale: config.locale } : {}),
    },
    { stage: "llm", relativePath: "AGENTS.md", locale: config.locale },
    (transformer, value, context) =>
      transformer.beforeAgentsMd?.(value, context)
  );
  await writeFile(outputPath, artifact.content);
  return { outputPath };
}

/* ---------------- Navigation manifest ----------------------------------- */

function pageView(
  doc: SourceDoc,
  tocByUrlPath: Map<string, DocsTableOfContentsItem[]>
): DocsNavigationPage {
  return {
    urlPath: doc.urlPath,
    relativePath: doc.relativePath,
    title: doc.title,
    description: doc.description,
    groups: [...doc.groups],
    toc: tocByUrlPath.get(doc.urlPath) ?? [],
    ...(doc.locale ? { locale: doc.locale } : {}),
    ...(doc.sourceLocale ? { sourceLocale: doc.sourceLocale } : {}),
    ...(doc.isFallback === undefined ? {} : { isFallback: doc.isFallback }),
    ...(doc.logicalPath ? { logicalPath: doc.logicalPath } : {}),
  };
}

function buildNavigationGroup(
  group: ResolvedGroup,
  membership: GroupMembership,
  tocByUrlPath: Map<string, DocsTableOfContentsItem[]>
): DocsNavigationGroup {
  const directPages = membership.byGroupSlug.get(group.slugKey) ?? [];
  return {
    slug: group.slug,
    segmentPath: group.segmentPath,
    title: group.title,
    description: group.description,
    pages: directPages.map((page) => pageView(page, tocByUrlPath)),
    children: group.children.map((child) =>
      buildNavigationGroup(child, membership, tocByUrlPath)
    ),
  };
}

function buildNavigationGroupFromNav(
  group: ResolvedGroup,
  docs: SourceDoc[],
  docsByRelativePath: Map<string, SourceDoc>,
  tocByUrlPath: Map<string, DocsTableOfContentsItem[]>,
  referencedUrlPaths: Set<string>
): DocsNavigationGroup {
  const directPages: SourceDoc[] = [];
  const groupSeenUrlPaths = new Set<string>();
  for (const entry of group.pageEntries) {
    const pages = resolveNavEntryPages(group, entry, docs, docsByRelativePath);
    for (const page of pages) {
      if (groupSeenUrlPaths.has(page.urlPath)) {
        continue;
      }
      groupSeenUrlPaths.add(page.urlPath);
      referencedUrlPaths.add(page.urlPath);
      directPages.push(page);
    }
  }

  return {
    slug: group.slug,
    segmentPath: group.segmentPath,
    title: group.title,
    description: group.description,
    ...(group.optional ? { optional: true } : {}),
    pages: directPages.map((page) => pageView(page, tocByUrlPath)),
    children: group.children.map((child) =>
      buildNavigationGroupFromNav(
        child,
        docs,
        docsByRelativePath,
        tocByUrlPath,
        referencedUrlPaths
      )
    ),
  };
}

function buildNavigationFromNav(
  docs: SourceDoc[],
  resolved: ResolvedGroup[],
  tocByUrlPath: Map<string, DocsTableOfContentsItem[]>,
  locale?: string,
  unknown: DocsNavigation["unknown"] = [],
  rootPageEntries: DocsNavPageEntry[] = []
): DocsNavigation {
  const referencedUrlPaths = new Set<string>();
  const docsByRelativePath = createDocsByRelativePath(docs);
  const rootPages: SourceDoc[] = [];
  if (rootPageEntries.length > 0) {
    const rootGroup: ResolvedGroup = {
      slug: "root",
      slugKey: "root",
      title: "Root",
      segmentPath: [],
      parent: null,
      children: [],
      base: "",
      pageEntries: rootPageEntries,
    };
    const rootSeenUrlPaths = new Set<string>();
    for (const entry of rootPageEntries) {
      const pages = resolveNavEntryPages(
        rootGroup,
        entry,
        docs,
        docsByRelativePath
      );
      for (const page of pages) {
        if (rootSeenUrlPaths.has(page.urlPath)) {
          continue;
        }
        rootSeenUrlPaths.add(page.urlPath);
        referencedUrlPaths.add(page.urlPath);
        rootPages.push(page);
      }
    }
  }
  const groups = resolved.map((group) =>
    buildNavigationGroupFromNav(
      group,
      docs,
      docsByRelativePath,
      tocByUrlPath,
      referencedUrlPaths
    )
  );
  return {
    groups,
    ungrouped: [
      ...rootPages,
      ...docs.filter((doc) => !referencedUrlPaths.has(doc.urlPath)),
    ].map((page) => pageView(page, tocByUrlPath)),
    unknown,
    ...(locale ? { locale } : {}),
  };
}

function findUnknownGroups(
  docs: SourceDoc[],
  groups: DocsGroup[] | undefined
): DocsNavigation["unknown"] {
  if (!(groups && groups.length > 0)) {
    return [];
  }
  const resolved = resolveGroups(groups);
  const membership = buildGroupMembership(docs, resolved);
  return membership.unknown.map(({ page, slug }) => ({
    urlPath: page.urlPath,
    slug,
  }));
}

/**
 * Walk the docs source tree once and return a structured navigation manifest.
 * Build pipelines write this to disk (e.g. `src/generated/docs-nav.json`)
 * for the runtime docs shell to import — keeps the docs-config.ts as the single
 * source of truth without forcing the runtime to scan MDX itself.
 */
export async function resolveDocsNavigation(
  config: ResolveDocsNavigationConfig
): Promise<DocsNavigation> {
  const srcDir = path.resolve(config.srcDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const sourceDocs = await readSourceDocs(
    srcDir,
    baseUrl,
    config.mounts,
    config.docsDirName,
    {
      i18n: config.i18n,
      locale: config.locale,
      includeFallback: config.includeFallback ?? true,
    }
  );
  const tocOptions = resolveNavigationTocOptions(config.toc);
  const tocByUrlPath = new Map<string, DocsTableOfContentsItem[]>();
  const docs = [...sourceDocs.values()];

  if (tocOptions !== false) {
    for (const page of sourceDocs.values()) {
      tocByUrlPath.set(
        page.urlPath,
        extractDocsTableOfContents(page.content, page, tocOptions)
      );
    }
  }

  if (config.nav && config.nav.length > 0) {
    const resolvedNav = resolveNavConfig(config.nav);
    return buildNavigationFromNav(
      docs,
      resolvedNav.groups,
      tocByUrlPath,
      config.locale ?? normalizeDocsI18nConfig(config.i18n)?.defaultLocale,
      findUnknownGroups(docs, config.groups),
      resolvedNav.rootPageEntries
    );
  }

  const resolved = resolveGroups(config.groups ?? []);
  const membership = buildGroupMembership(docs, resolved);
  return {
    groups: resolved.map((group) =>
      buildNavigationGroup(group, membership, tocByUrlPath)
    ),
    ungrouped: membership.ungrouped.map((page) => pageView(page, tocByUrlPath)),
    unknown: membership.unknown.map(({ page, slug }) => ({
      urlPath: page.urlPath,
      slug,
    })),
    locale:
      config.locale ?? normalizeDocsI18nConfig(config.i18n)?.defaultLocale,
  };
}

export async function resolveDocsTableOfContents(
  config: ResolveDocsTableOfContentsConfig
): Promise<DocsTableOfContentsPage[]> {
  const srcDir = path.resolve(config.srcDir);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const sourceDocs = await readSourceDocs(
    srcDir,
    baseUrl,
    config.mounts,
    DOCS_DIRNAME,
    {
      i18n: config.i18n,
      locale: config.locale,
      includeFallback: false,
    }
  );

  return [...sourceDocs.values()]
    .sort((left, right) => left.urlPath.localeCompare(right.urlPath))
    .map((page) => ({
      absoluteUrl: page.absoluteUrl,
      description: page.description,
      relativePath: page.relativePath,
      title: page.title,
      urlPath: page.urlPath,
      toc: extractDocsTableOfContents(page.content, page, config.options),
    }));
}
