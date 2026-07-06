import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Root } from "mdast";
import { mdxToMdast } from "satteri";
import { glob as fg } from "tinyglobby";
import { visit } from "unist-util-visit";
import * as v from "valibot";
import { convertMdxToMarkdown } from "../convert";
import {
  deriveDocContext,
  hasDocPlaceholder,
  normalizeDocsUrl,
} from "../internal/docs-context";
import {
  type DocsPathMount,
  matchesUrlPrefix,
  normalizeDocsPath,
  toDocsUrlPath,
} from "../internal/docs-url";
import { parseFrontmatter } from "../internal/frontmatter";
import { extractDocsTableOfContents } from "../llm/llm";
import {
  type DocsTableOfContentsItem,
  validateJsonLd,
} from "../llm/readability";
import {
  BUILTIN_FLATTENER_COMPONENT_NAMES,
  defaultMarkdownTransforms,
  includeMarkdown,
} from "../markdown";
import type { DocsRedirect } from "../redirects/redirects";
import { remarkStripSnippetDirectives } from "../remark/plugins/strip-snippet-directives.remark";
import {
  allowedKeys,
  defaultChangelogFrontmatterSchema,
  defaultFrontmatterSchema,
  defaultMetaSchema,
} from "./schema";
import { collectFenceValues, collectSnippetIssues } from "./snippet-lint";
import {
  collectTypecheckSnippets,
  type TypecheckSnippet,
  typecheckSnippets,
} from "./snippet-typecheck";

export type LintSeverity = "error" | "warn";

export type LintRule =
  | "schema"
  | "unknown-field"
  | "missing-field"
  | "parse-error"
  | "invalid-link"
  | "unresolved-placeholder"
  | "cross-framework-link"
  | "unflattened-component"
  | "jsonld"
  | "config-link"
  | "invalid-anchor"
  | "snippet:parse"
  | "snippet:types"
  | "geo:heading-skip"
  | "geo:code-language"
  | "geo:image-alt";

/** `"off"` drops the rule's violations entirely; otherwise remaps severity. */
export type LintRuleSeverity = "off" | LintSeverity;

export type LintRuleOverrides = Partial<Record<LintRule, LintRuleSeverity>>;

export type LintViolation = {
  file: string;
  kind: "frontmatter" | "changelog" | "meta" | "content" | "config";
  severity: LintSeverity;
  rule: LintRule;
  field?: string;
  message: string;
};

export type LintSummary = {
  filesScanned: number;
  errors: number;
  warnings: number;
};

export type LintResult = {
  violations: LintViolation[];
  summary: LintSummary;
};

export type LintOptions = {
  /** Root directory containing .mdx/.md files and meta.json */
  srcDir: string;
  /** Optional subdirectory that uses the changelog schema instead */
  changelogDir?: string;
  /**
   * Glob patterns (relative to srcDir) to skip — use for include-only partials
   * like `shared/**`, `_shared/**`, `_partials/**`, or orphan drafts. Matched
   * against POSIX-style relative paths. Default: ["**\/shared/**", ...]
   */
  ignore?: string[];
  /** Treat unknown frontmatter fields as warnings (default) or errors */
  unknownFieldSeverity?: LintSeverity;
  /**
   * Component names that flatten to markdown beyond the built-in tag contract —
   * typically the names of custom `defineComponentFlattener` plugins from
   * config. Used by the `unflattened-component` rule to avoid warning on
   * components the consumer has actually wired a flattener for.
   */
  knownComponents?: string[];
  /**
   * Path-to-URL mounts from the docs config. Routes are derived with mounts
   * applied (`changelog/x.mdx` → `/changelog/x`), and links under every mount
   * prefix are validated like `/docs/...` links.
   */
  mounts?: DocsPathMount[];
  /**
   * Link prefixes assumed valid without a matching source file — generated
   * page trees whose routes only exist after `leadtype generate` (e.g. the
   * OpenAPI `output` prefix). Checked against normalized URL paths.
   */
  assumeValidLinkPrefixes?: string[];
  /**
   * Per-rule severity overrides (`"off"` disables a rule). Typically supplied
   * by the `lint.rules` block in `docs.config.ts`.
   */
  rules?: LintRuleOverrides;
  /**
   * Precomputed route set (from `collectRouteSet`) so callers that also lint
   * config links don't glob the tree twice. Must be built with the same
   * `srcDir`/`ignore`/`mounts`.
   */
  routeSet?: ReadonlySet<string>;
  /**
   * Redirect entries from the paths lockfile. An `invalid-link` whose target
   * matches a redirect reports where the page moved instead of a bare
   * missing-route message.
   */
  redirects?: DocsRedirect[];
  /**
   * Opt-in snippet typechecking (`snippet:types`): module-shaped `ts`/`tsx`
   * snippets typecheck against `projectRoot`'s `tsconfig.json` and
   * `node_modules`, so API drift in doc examples fails lint. Enabled via
   * `lint.snippets.typecheck` in the docs config.
   */
  snippetTypecheck?: { projectRoot: string };
  /** Custom schemas override the defaults */
  schemas?: {
    frontmatter?: v.ObjectSchema<
      v.ObjectEntries,
      v.ErrorMessage<v.ObjectIssue> | undefined
    >;
    changelogFrontmatter?: v.ObjectSchema<
      v.ObjectEntries,
      v.ErrorMessage<v.ObjectIssue> | undefined
    >;
    meta?: v.ObjectSchema<
      v.ObjectEntries,
      v.ErrorMessage<v.ObjectIssue> | undefined
    >;
  };
};

async function glob(
  root: string,
  patterns: string[],
  ignore: string[]
): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }
  return await fg(patterns, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore,
    dot: false,
    // Preserve fast-glob semantics: callers can pass user-supplied ignores,
    // and bare directory entries should not auto-expand to `dir/**`.
    expandDirectories: false,
  });
}

function toRelative(srcDir: string, file: string): string {
  const rel = relative(srcDir, file);
  return rel.split(sep).join("/");
}

function isUnderDir(file: string, dir: string | undefined): boolean {
  if (!dir) {
    return false;
  }
  const rel = relative(dir, file);
  return !(rel.startsWith("..") || rel.startsWith(sep));
}

function pathForIssue(issue: v.BaseIssue<unknown>): string | undefined {
  const segments = issue.path?.map((p) => String(p.key)).filter(Boolean);
  return segments && segments.length > 0 ? segments.join(".") : undefined;
}

function validate<T extends Record<string, unknown>>(
  schema: v.ObjectSchema<
    v.ObjectEntries,
    v.ErrorMessage<v.ObjectIssue> | undefined
  >,
  data: T,
  file: string,
  kind: LintViolation["kind"],
  unknownSeverity: LintSeverity
): LintViolation[] {
  const out: LintViolation[] = [];
  const result = v.safeParse(schema, data);

  if (!result.success) {
    for (const issue of result.issues) {
      const field = pathForIssue(issue);
      out.push({
        file,
        kind,
        severity: "error",
        rule: "schema",
        field,
        message: field ? `${field}: ${issue.message}` : issue.message,
      });
    }
  }

  const allowed = allowedKeys(schema);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      out.push({
        file,
        kind,
        severity: unknownSeverity,
        rule: "unknown-field",
        field: key,
        message: `unknown field \`${key}\` — not in schema and not read by any consumer`,
      });
    }
  }

  return out;
}

/**
 * Walk `srcDir` and validate every .md/.mdx frontmatter plus every meta.json
 * file. Returns a list of violations with a summary count.
 */
export const DEFAULT_IGNORE_GLOBS = [
  "**/shared/**",
  "**/_shared/**",
  "**/_partials/**",
  "**/node_modules/**",
];

const ROUTE_INDEX_IGNORE_GLOBS = [
  "**/_shared/**",
  "**/_partials/**",
  "**/node_modules/**",
];

type UrlCandidate = {
  field?: string;
  url: string;
};

const URL_LIKE_FIELD_NAMES = new Set([
  "canonicalUrl",
  "href",
  "link",
  "path",
  "permalink",
  "to",
  "url",
]);

function frameworkFromDocsUrl(url: string): string | null {
  const match = url.match(/^\/docs\/frameworks\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function lastFieldSegment(path: string): string | null {
  if (!path) {
    return null;
  }

  const segment = path.split(".").at(-1) ?? "";
  return segment.replace(/\[\d+\]$/u, "") || null;
}

/**
 * Prefixes whose links are validated against the route set. Always `/docs`,
 * plus every mount `urlPrefix` from the docs config. A root mount (`/`) is
 * deliberately excluded — it would classify every absolute path on the site
 * (marketing pages, app routes) as a docs link.
 */
export function internalLinkPrefixes(mounts?: DocsPathMount[]): string[] {
  const prefixes = new Set<string>(["/docs"]);
  for (const mount of mounts ?? []) {
    const normalized = normalizeInternalPrefix(mount.urlPrefix);
    if (normalized !== "/") {
      prefixes.add(normalized);
    }
  }
  return [...prefixes];
}

function normalizeInternalPrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isInternalDocsUrl(
  value: string,
  prefixes: readonly string[]
): boolean {
  return prefixes.some((prefix) => matchesUrlPrefix(value, prefix));
}

function looksLikeDocsUrlCandidate(
  value: string,
  prefixes: readonly string[],
  field?: string
): boolean {
  if (isInternalDocsUrl(value, prefixes)) {
    return true;
  }

  if (!hasDocPlaceholder(value)) {
    return false;
  }

  return field ? URL_LIKE_FIELD_NAMES.has(field) : false;
}

function looksLikeMarkdownUrlCandidate(
  value: string,
  prefixes: readonly string[]
): boolean {
  if (isInternalDocsUrl(value, prefixes)) {
    return true;
  }
  // Relative links resolve against the source file; same-page anchors
  // resolve against the page's own headings.
  if (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("#")
  ) {
    return true;
  }

  return hasDocPlaceholder(value) && value.includes("/docs/");
}

function collectFrontmatterUrls(
  value: unknown,
  prefixes: readonly string[],
  path = ""
): UrlCandidate[] {
  if (typeof value === "string") {
    const field = lastFieldSegment(path) ?? undefined;
    if (looksLikeDocsUrlCandidate(value, prefixes, field)) {
      return [{ field: path || undefined, url: value }];
    }
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectFrontmatterUrls(entry, prefixes, `${path}[${index}]`)
    );
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, entryValue]) => {
      const nextPath = path ? `${path}.${key}` : key;
      return collectFrontmatterUrls(entryValue, prefixes, nextPath);
    });
  }

  return [];
}

function collectMarkdownUrls(
  markdown: string,
  prefixes: readonly string[]
): UrlCandidate[] {
  const urls = new Set<string>();
  const tree = mdxToMdast(markdown, {
    features: { frontmatter: false, gfm: true },
  }) as Root;
  const definitions = new Map<string, string>();

  visit(tree, "definition", (node: { identifier?: string; url?: string }) => {
    const url = node.url ?? "";
    if (looksLikeMarkdownUrlCandidate(url, prefixes)) {
      urls.add(url);
    }

    const identifier = node.identifier?.toLowerCase();
    if (identifier) {
      definitions.set(identifier, url);
    }
  });

  visit(tree, "link", (node: { url?: string }) => {
    const url = node.url ?? "";
    if (looksLikeMarkdownUrlCandidate(url, prefixes)) {
      urls.add(url);
    }
  });

  visit(tree, "linkReference", (node: { identifier?: string }) => {
    const identifier = node.identifier?.toLowerCase();
    const url = identifier ? (definitions.get(identifier) ?? "") : "";

    if (looksLikeMarkdownUrlCandidate(url, prefixes)) {
      urls.add(url);
    }
  });

  return Array.from(urls, (url) => ({ url }));
}

/**
 * Anchor ids a page's rendered markdown generates, using the same extractor
 * (slugger, duplicate suffixing, fence handling) that builds the site TOC —
 * so lint and the rendered site can't disagree about which anchors exist.
 */
function collectAnchors(content: string, urlPath: string): ReadonlySet<string> {
  const anchors = new Set<string>();
  const walk = (items: DocsTableOfContentsItem[]): void => {
    for (const item of items) {
      anchors.add(item.id);
      walk(item.children);
    }
  };
  walk(
    extractDocsTableOfContents(
      content,
      { absoluteUrl: "", urlPath },
      { minLevel: 1, maxLevel: 6 }
    )
  );
  return anchors;
}

/**
 * A trailing extension that marks a relative link as a non-doc asset
 * (`./api.pdf`, `./schema.json`) rather than a page. `.md`/`.mdx` stay doc
 * candidates, and a dotted page name like `./v0.4` doesn't count as an
 * extension (extensions start with a letter).
 */
const NON_DOC_EXTENSION_PATTERN = /\.(?!mdx?$)[a-z][a-z0-9]*$/i;

/**
 * Resolve a `./x` / `../x` link against its source file's directory into a
 * docs-relative path (extension stripped). Returns null when the link climbs
 * out of the docs tree.
 */
function resolveRelativeDocPath(
  sourceRelPath: string,
  url: string
): string | null {
  const withoutExtension = url.replace(/\.(mdx|md)$/i, "");
  const segments = sourceRelPath.split("/").slice(0, -1);
  for (const part of withoutExtension.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

type ValidateDocUrlsOptions = {
  candidates: UrlCandidate[];
  file: string;
  kind: LintViolation["kind"];
  routeSet: ReadonlySet<string>;
  currentFramework: string | null;
  internalPrefixes: readonly string[];
  assumeValidLinkPrefixes: readonly string[];
  /** Docs-relative POSIX path of the source file (for relative links). */
  sourceRelPath: string;
  /** The page's own route (for same-page `#anchor` links). */
  currentRoute: string;
  /** Anchor ids per route, from every linted page's rendered markdown. */
  anchorsByRoute: ReadonlyMap<string, ReadonlySet<string>>;
  mounts?: DocsPathMount[];
  redirects?: DocsRedirect[];
};

function validateDocUrls(options: ValidateDocUrlsOptions): LintViolation[] {
  const {
    candidates,
    file,
    kind,
    routeSet,
    currentFramework,
    internalPrefixes,
    assumeValidLinkPrefixes,
    sourceRelPath,
    currentRoute,
    anchorsByRoute,
    mounts,
    redirects,
  } = options;
  const violations: LintViolation[] = [];
  const pushViolation = (
    rule: LintRule,
    field: string | undefined,
    message: string
  ): void => {
    violations.push({ file, kind, severity: "error", rule, field, message });
  };

  for (const candidate of candidates) {
    if (hasDocPlaceholder(candidate.url)) {
      pushViolation(
        "unresolved-placeholder",
        candidate.field,
        `unresolved placeholder in docs URL \`${candidate.url}\``
      );
      continue;
    }

    const hashIndex = candidate.url.indexOf("#");
    const pathPart =
      hashIndex === -1 ? candidate.url : candidate.url.slice(0, hashIndex);
    const anchor =
      hashIndex === -1 ? undefined : candidate.url.slice(hashIndex + 1);

    // Resolve the candidate to a route, or skip it as external.
    let targetRoute: string;
    if (pathPart === "") {
      // Same-page anchor: `#section`.
      targetRoute = currentRoute;
    } else if (isInternalDocsUrl(pathPart, internalPrefixes)) {
      targetRoute = normalizeDocsUrl(pathPart);
    } else if (pathPart.startsWith("./") || pathPart.startsWith("../")) {
      // Relative links to non-doc assets aren't routes — skip them like
      // external links.
      if (NON_DOC_EXTENSION_PATTERN.test(pathPart)) {
        continue;
      }
      const resolved = resolveRelativeDocPath(sourceRelPath, pathPart);
      if (resolved === null) {
        pushViolation(
          "invalid-link",
          candidate.field,
          `relative link \`${candidate.url}\` resolves outside the docs tree`
        );
        continue;
      }
      targetRoute = toDocsUrlPath(resolved, mounts);
    } else {
      continue;
    }

    // Generated page trees (e.g. the OpenAPI output prefix) only exist after
    // `leadtype generate`; their links are assumed valid rather than
    // reported as missing routes.
    if (isInternalDocsUrl(targetRoute, assumeValidLinkPrefixes)) {
      continue;
    }

    const targetFramework = frameworkFromDocsUrl(targetRoute);
    if (
      currentFramework &&
      targetFramework &&
      currentFramework !== targetFramework
    ) {
      pushViolation(
        "cross-framework-link",
        candidate.field,
        `links to \`${targetRoute}\`, which targets framework \`${targetFramework}\` instead of \`${currentFramework}\``
      );
      continue;
    }

    if (!routeSet.has(targetRoute)) {
      const moved = redirects?.find((entry) => entry.from === targetRoute);
      pushViolation(
        "invalid-link",
        candidate.field,
        moved?.to
          ? `links to \`${targetRoute}\`, which moved to \`${moved.to}\` — update the link`
          : `links to missing docs route \`${targetRoute}\``
      );
      continue;
    }

    if (anchor) {
      const anchors = anchorsByRoute.get(targetRoute);
      if (anchors && !anchors.has(anchor)) {
        pushViolation(
          "invalid-anchor",
          candidate.field,
          `links to \`${targetRoute}#${anchor}\`, but no heading on that page generates the anchor`
        );
      }
    }
  }

  return violations;
}

function parseMdxBody(body: string): Root | null {
  try {
    return mdxToMdast(body, {
      features: { frontmatter: false, gfm: true },
    }) as Root;
  } catch {
    return null;
  }
}

type GeoIssue = {
  rule: "geo:code-language" | "geo:heading-skip" | "geo:image-alt";
  line?: number;
  message: string;
};

/**
 * Structural GEO checks over a page body: skipped heading levels, unlabeled code
 * fences, and images without alt text. These are the mechanical signals from the
 * "Write for agents & GEO" guide — the editorial ones (lead-with-answer,
 * question-form headings) can't be linted. All warn-level: legitimate exceptions
 * exist, so they never block by default.
 */
function collectGeoIssues(tree: Root | null): GeoIssue[] {
  if (!tree) {
    return []; // parse errors are reported by the link-check path
  }

  const issues: GeoIssue[] = [];
  // The frontmatter title is the page's implicit H1, so the first authored
  // heading should be H2. Seed at 1 so a page that opens at H3+ trips the rule.
  let prevDepth = 1;
  visit(tree, (node) => {
    const element = node as {
      type: string;
      depth?: number;
      lang?: unknown;
      alt?: unknown;
      position?: { start?: { line?: number } };
    };
    const line = element.position?.start?.line;
    if (element.type === "heading" && typeof element.depth === "number") {
      if (prevDepth > 0 && element.depth > prevDepth + 1) {
        issues.push({
          rule: "geo:heading-skip",
          line,
          message: `heading jumps from H${prevDepth} to H${element.depth} — keep the hierarchy sequential (no skipped levels) so answer engines can parse the topic tree`,
        });
      }
      prevDepth = element.depth;
    } else if (element.type === "code") {
      if (
        typeof element.lang !== "string" ||
        element.lang.trim().length === 0
      ) {
        issues.push({
          rule: "geo:code-language",
          line,
          message:
            "fenced code block has no language — label it (e.g. ```ts) so answer engines surface it for the right stack",
        });
      }
    } else if (
      element.type === "image" &&
      (typeof element.alt !== "string" || element.alt.trim().length === 0)
    ) {
      issues.push({
        rule: "geo:image-alt",
        line,
        message:
          "image has no alt text — describe what it conveys; answer engines can't see images",
      });
    }
  });
  return issues;
}
// A JSX element is a component (not an intrinsic HTML element) when its name is
// capitalized or a member expression like `Foo.Bar`.
const COMPONENT_NAME_PATTERN = /^[A-Z]/;

/**
 * Find JSX components in `body` that won't flatten to markdown — i.e. names not
 * in the built-in tag contract and not covered by a registered custom
 * flattener. These leak raw JSX into the generated agent markdown.
 */
function collectUnflattenedComponents(
  tree: Root | null,
  recognized: Set<string>
): { line?: number; name: string }[] {
  if (!tree) {
    // Parse failures are reported by the markdown link-check path as
    // `parse-error`; don't double-report here.
    return [];
  }

  const seen = new Map<string, number | undefined>();
  visit(tree, (node) => {
    const element = node as {
      name?: unknown;
      position?: { start?: { line?: number } };
      type: string;
    };
    if (
      element.type !== "mdxJsxFlowElement" &&
      element.type !== "mdxJsxTextElement"
    ) {
      return;
    }
    const name = element.name;
    if (typeof name !== "string" || name.length === 0) {
      return; // fragments (<>…</>)
    }
    const isComponent = COMPONENT_NAME_PATTERN.test(name) || name.includes(".");
    if (!isComponent || recognized.has(name) || seen.has(name)) {
      return;
    }
    seen.set(name, element.position?.start?.line);
  });
  return Array.from(seen, ([name, line]) => ({ name, line }));
}

export async function lintDocs(options: LintOptions): Promise<LintResult> {
  const {
    srcDir,
    changelogDir,
    ignore = DEFAULT_IGNORE_GLOBS,
    unknownFieldSeverity = "warn",
    schemas = {},
    knownComponents = [],
  } = options;

  const recognizedComponents = new Set<string>([
    ...BUILTIN_FLATTENER_COMPONENT_NAMES,
    ...knownComponents,
  ]);

  const frontmatterSchema = schemas.frontmatter ?? defaultFrontmatterSchema;
  const changelogSchema =
    schemas.changelogFrontmatter ?? defaultChangelogFrontmatterSchema;
  const metaSchema = schemas.meta ?? defaultMetaSchema;

  // `changelogDir` is documented as a subdirectory of srcDir, so resolve it
  // upfront. Absolute paths pass through resolve unchanged.
  const resolvedChangelogDir = changelogDir
    ? resolve(srcDir, changelogDir)
    : undefined;

  const violations: LintViolation[] = [];

  const mdxFiles = await glob(srcDir, ["**/*.mdx", "**/*.md"], ignore);
  const metaFiles = await glob(srcDir, ["**/meta.json"], ignore);
  const mounts = options.mounts;
  const routeSet =
    options.routeSet ?? (await collectRouteSet({ srcDir, ignore, mounts }));
  const internalPrefixes = internalLinkPrefixes(mounts);
  // Link validation is deferred until every page's anchors are known, so
  // cross-page `#anchor` checks see the full map.
  type PendingLinkCheck = {
    file: string;
    kind: LintViolation["kind"];
    frontmatterCandidates: UrlCandidate[];
    contentCandidates: UrlCandidate[];
    currentFramework: string | null;
    sourceRelPath: string;
    currentRoute: string;
  };
  const pendingLinkChecks: PendingLinkCheck[] = [];
  const anchorsByRoute = new Map<string, ReadonlySet<string>>();
  const typecheckQueue: TypecheckSnippet[] = [];
  const assumeValidLinkPrefixes = (options.assumeValidLinkPrefixes ?? []).map(
    (prefix) => normalizeInternalPrefix(prefix)
  );
  const filesScanned = mdxFiles.length + metaFiles.length;

  for (const file of mdxFiles) {
    // Classify up front so the parse-error path uses the correct kind.
    const isChangelog = isUnderDir(file, resolvedChangelogDir);
    const schemaToUse = isChangelog ? changelogSchema : frontmatterSchema;
    const kind: LintViolation["kind"] = isChangelog
      ? "changelog"
      : "frontmatter";

    let data: Record<string, unknown>;
    let body = "";
    // Frontmatter is stripped from `body` and its lines renumbered from 1, so
    // track the offset to report file-relative line numbers.
    let bodyLineOffset = 0;
    const relativeFile = toRelative(srcDir, file);
    try {
      const raw = await readFile(file, "utf-8");
      const parsed = parseFrontmatter(raw);
      data = parsed.data;
      body = parsed.content;
      bodyLineOffset = raw.split("\n").length - body.split("\n").length;
    } catch (error) {
      violations.push({
        file: relativeFile,
        kind,
        severity: "error",
        rule: "parse-error",
        message: `failed to parse frontmatter: ${String(error)}`,
      });
      continue;
    }

    violations.push(
      ...validate(schemaToUse, data, relativeFile, kind, unknownFieldSeverity)
    );

    // JSON-LD validity: render the identity fields the per-page TechArticle is
    // built from and structurally validate them. Catches the common breakage — a
    // malformed date that would emit an invalid `dateModified`. Skips changelog
    // entries (not docs pages) and pages without a title (already flagged above).
    if (!isChangelog && typeof data.title === "string") {
      const rawDate =
        data.lastModified ?? data.last_updated ?? data.dateModified;
      const dateModified =
        rawDate instanceof Date ? rawDate.toISOString() : rawDate;
      const jsonLdIssues = validateJsonLd({
        "@context": "https://schema.org",
        "@type": "TechArticle",
        name: data.title,
        headline: data.title,
        ...(dateModified === undefined ? {} : { dateModified }),
      });
      for (const issue of jsonLdIssues) {
        violations.push({
          file: relativeFile,
          kind: "content",
          severity: "warn",
          rule: "jsonld",
          message: `JSON-LD would be invalid — ${issue}. Broken schema is worse than none.`,
        });
      }
    }

    // The source body parses once; the component, GEO, and snippet walks all
    // share the tree.
    const bodyTree = parseMdxBody(body);

    // Flag components that won't flatten — they'd leak raw JSX into the agent
    // markdown. Walks the MDX AST, so JSX inside code fences (a `code` node, not
    // a JSX element) is correctly ignored.
    for (const { name, line } of collectUnflattenedComponents(
      bodyTree,
      recognizedComponents
    )) {
      const fileLine = line ? line + bodyLineOffset : undefined;
      violations.push({
        file: relativeFile,
        kind: "content",
        severity: "warn",
        rule: "unflattened-component",
        message: `<${name}>${fileLine ? ` (line ${fileLine})` : ""} has no markdown flattener — agents will see raw JSX in the generated markdown. Add one with defineComponentFlattener, or rename to a built-in tag.`,
      });
    }

    // Structural GEO checks (warn): skipped headings, unlabeled code, missing alt.
    for (const issue of collectGeoIssues(bodyTree)) {
      const fileLine = issue.line ? issue.line + bodyLineOffset : undefined;
      violations.push({
        file: relativeFile,
        kind: "content",
        severity: "warn",
        rule: issue.rule,
        message: `${issue.message}${fileLine ? ` (line ${fileLine})` : ""}`,
      });
    }

    if (options.snippetTypecheck) {
      typecheckQueue.push(...collectTypecheckSnippets(bodyTree, relativeFile));
    }

    // Parse-level snippet checks (error): a fenced block with a known
    // language must parse. `// @noErrors` marks deliberate fragments.
    for (const issue of collectSnippetIssues(bodyTree)) {
      const fileLine = issue.line ? issue.line + bodyLineOffset : undefined;
      violations.push({
        file: relativeFile,
        kind: "content",
        severity: "error",
        rule: issue.rule,
        message: `${issue.message}${fileLine ? ` (line ${fileLine})` : ""}`,
      });
    }

    try {
      // Lint renders WITHOUT directive stripping: `// @noErrors` and friends
      // are exactly what the snippet checks need to see, and stripping would
      // desync the rendered fences from their source values.
      const converted = await convertMdxToMarkdown(file, [
        includeMarkdown,
        ...defaultMarkdownTransforms.filter(
          (transform) => transform !== remarkStripSnippetDirectives
        ),
      ]);
      const rendered = parseFrontmatter(converted.markdown);
      // Snippets contributed by <include> targets only exist post-expansion
      // (partials are ignored files); check them here, deduped against the
      // source pass so directly-authored fences aren't reported twice.
      for (const issue of collectSnippetIssues(parseMdxBody(rendered.content), {
        skipValues: collectFenceValues(bodyTree),
        fromRendered: true,
      })) {
        violations.push({
          file: relativeFile,
          kind: "content",
          severity: "error",
          rule: issue.rule,
          message: issue.message,
        });
      }
      const currentFramework = deriveDocContext(file).framework;
      const sourceRelPath = toRelative(srcDir, file);
      const currentRoute = toDocsUrlPath(
        normalizeDocsPath(relative(srcDir, file)),
        mounts
      );
      // Anchors come from the rendered markdown (includes expanded), so a
      // heading contributed by an <include> target still counts.
      anchorsByRoute.set(
        currentRoute,
        collectAnchors(rendered.content, currentRoute)
      );
      pendingLinkChecks.push({
        file: relativeFile,
        kind,
        frontmatterCandidates: collectFrontmatterUrls(
          rendered.data,
          internalPrefixes
        ),
        contentCandidates: collectMarkdownUrls(
          rendered.content,
          internalPrefixes
        ),
        currentFramework,
        sourceRelPath,
        currentRoute,
      });
    } catch (error) {
      violations.push({
        file: relativeFile,
        kind: "content",
        severity: "error",
        rule: "parse-error",
        message: `failed to render markdown for link checks: ${String(error)}`,
      });
    }
  }

  for (const pending of pendingLinkChecks) {
    const shared = {
      file: pending.file,
      routeSet,
      currentFramework: pending.currentFramework,
      internalPrefixes,
      assumeValidLinkPrefixes,
      sourceRelPath: pending.sourceRelPath,
      currentRoute: pending.currentRoute,
      anchorsByRoute,
      mounts,
      redirects: options.redirects,
    };
    violations.push(
      ...validateDocUrls({
        ...shared,
        candidates: pending.frontmatterCandidates,
        kind: pending.kind,
      }),
      ...validateDocUrls({
        ...shared,
        candidates: pending.contentCandidates,
        kind: "content",
      })
    );
  }

  for (const file of metaFiles) {
    let data: Record<string, unknown>;
    try {
      const raw = await readFile(file, "utf-8");
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      violations.push({
        file: toRelative(srcDir, file),
        kind: "meta",
        severity: "error",
        rule: "parse-error",
        message: `failed to parse meta.json: ${String(error)}`,
      });
      continue;
    }

    violations.push(
      ...validate(
        metaSchema,
        data,
        toRelative(srcDir, file),
        "meta",
        unknownFieldSeverity
      )
    );
  }

  if (options.snippetTypecheck && typecheckQueue.length > 0) {
    for (const issue of typecheckSnippets({
      snippets: typecheckQueue,
      projectRoot: options.snippetTypecheck.projectRoot,
    })) {
      violations.push({
        file: issue.file,
        kind: "content",
        severity: "error",
        rule: issue.rule,
        message: `${issue.message}${issue.line ? ` (line ${issue.line})` : ""}`,
      });
    }
  }

  const effective = applyRuleOverrides(violations, options.rules);

  let errorCount = 0;
  let warningCount = 0;
  for (const violation of effective) {
    if (violation.severity === "error") {
      errorCount += 1;
    } else {
      warningCount += 1;
    }
  }
  const summary: LintSummary = {
    filesScanned,
    errors: errorCount,
    warnings: warningCount,
  };

  return { violations: effective, summary };
}

/**
 * Route set for a docs tree: every page URL with mounts applied. Shared by
 * page-link and config-link validation so the two can't drift.
 */
export async function collectRouteSet(opts: {
  srcDir: string;
  ignore?: string[];
  mounts?: DocsPathMount[];
}): Promise<Set<string>> {
  const ignore = opts.ignore ?? DEFAULT_IGNORE_GLOBS;
  const routeIgnore = [...new Set([...ignore, ...ROUTE_INDEX_IGNORE_GLOBS])];
  const routeFiles = await glob(
    resolve(opts.srcDir),
    ["**/*.mdx", "**/*.md"],
    routeIgnore
  );
  return new Set(
    routeFiles.map((filePath) =>
      toDocsUrlPath(
        normalizeDocsPath(relative(resolve(opts.srcDir), filePath)),
        opts.mounts
      )
    )
  );
}

/**
 * Apply per-rule severity overrides from the `lint.rules` config block.
 * `"off"` drops a rule's violations; `"warn"`/`"error"` remap severity.
 */
export function applyRuleOverrides(
  violations: LintViolation[],
  rules?: LintRuleOverrides
): LintViolation[] {
  if (!rules) {
    return violations;
  }
  const result: LintViolation[] = [];
  for (const violation of violations) {
    const override = rules[violation.rule];
    if (override === "off") {
      continue;
    }
    result.push(
      override && override !== violation.severity
        ? { ...violation, severity: override }
        : violation
    );
  }
  return result;
}

export type {
  DefaultChangelogFrontmatter,
  DefaultFrontmatter,
  DefaultMeta,
} from "./schema";
