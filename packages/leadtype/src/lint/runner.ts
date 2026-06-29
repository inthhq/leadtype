import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import { glob as fg } from "tinyglobby";
import { visit } from "unist-util-visit";
import * as v from "valibot";
import { convertMdxToMarkdown } from "../convert";
import {
  deriveDocContext,
  hasDocPlaceholder,
  normalizeDocsUrl,
  routeFromFilePath,
} from "../internal/docs-context";
import { parseFrontmatter } from "../internal/frontmatter";
import { validateJsonLd } from "../llm/readability";
import {
  BUILTIN_FLATTENER_COMPONENT_NAMES,
  defaultRemarkPlugins,
  remarkInclude,
} from "../remark";
import {
  allowedKeys,
  defaultChangelogFrontmatterSchema,
  defaultFrontmatterSchema,
  defaultMetaSchema,
} from "./schema";

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
  | "geo:heading-skip"
  | "geo:code-language"
  | "geo:image-alt";

export type LintViolation = {
  file: string;
  kind: "frontmatter" | "changelog" | "meta" | "content";
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

function looksLikeDocsUrlCandidate(value: string, field?: string): boolean {
  if (value.startsWith("/docs/")) {
    return true;
  }

  if (!hasDocPlaceholder(value)) {
    return false;
  }

  return field ? URL_LIKE_FIELD_NAMES.has(field) : false;
}

function looksLikeMarkdownUrlCandidate(value: string): boolean {
  if (value.startsWith("/docs/")) {
    return true;
  }

  return hasDocPlaceholder(value) && value.includes("/docs/");
}

function collectFrontmatterUrls(value: unknown, path = ""): UrlCandidate[] {
  if (typeof value === "string") {
    const field = lastFieldSegment(path) ?? undefined;
    if (looksLikeDocsUrlCandidate(value, field)) {
      return [{ field: path || undefined, url: value }];
    }
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectFrontmatterUrls(entry, `${path}[${index}]`)
    );
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, entryValue]) => {
      const nextPath = path ? `${path}.${key}` : key;
      return collectFrontmatterUrls(entryValue, nextPath);
    });
  }

  return [];
}

function collectMarkdownUrls(markdown: string): UrlCandidate[] {
  const urls = new Set<string>();
  const tree = remark().use(remarkGfm).parse(markdown);
  const definitions = new Map<string, string>();

  visit(tree, "definition", (node: { identifier?: string; url?: string }) => {
    const url = node.url ?? "";
    if (looksLikeMarkdownUrlCandidate(url)) {
      urls.add(url);
    }

    const identifier = node.identifier?.toLowerCase();
    if (identifier) {
      definitions.set(identifier, url);
    }
  });

  visit(tree, "link", (node: { url?: string }) => {
    const url = node.url ?? "";
    if (looksLikeMarkdownUrlCandidate(url)) {
      urls.add(url);
    }
  });

  visit(tree, "linkReference", (node: { identifier?: string }) => {
    const identifier = node.identifier?.toLowerCase();
    const url = identifier ? (definitions.get(identifier) ?? "") : "";

    if (looksLikeMarkdownUrlCandidate(url)) {
      urls.add(url);
    }
  });

  return Array.from(urls, (url) => ({ url }));
}

function validateDocUrls(
  candidates: UrlCandidate[],
  file: string,
  kind: LintViolation["kind"],
  routeSet: Set<string>,
  currentFramework: string | null
): LintViolation[] {
  const violations: LintViolation[] = [];

  for (const candidate of candidates) {
    if (hasDocPlaceholder(candidate.url)) {
      violations.push({
        file,
        kind,
        severity: "error",
        rule: "unresolved-placeholder",
        field: candidate.field,
        message: `unresolved placeholder in docs URL \`${candidate.url}\``,
      });
      continue;
    }

    if (!candidate.url.startsWith("/docs/")) {
      continue;
    }

    const normalizedUrl = normalizeDocsUrl(candidate.url);
    const targetFramework = frameworkFromDocsUrl(normalizedUrl);

    if (
      currentFramework &&
      targetFramework &&
      currentFramework !== targetFramework
    ) {
      violations.push({
        file,
        kind,
        severity: "error",
        rule: "cross-framework-link",
        field: candidate.field,
        message: `links to \`${normalizedUrl}\`, which targets framework \`${targetFramework}\` instead of \`${currentFramework}\``,
      });
      continue;
    }

    if (!routeSet.has(normalizedUrl)) {
      violations.push({
        file,
        kind,
        severity: "error",
        rule: "invalid-link",
        field: candidate.field,
        message: `links to missing docs route \`${normalizedUrl}\``,
      });
    }
  }

  return violations;
}

const mdxComponentParser = remark().use(remarkMdx);

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
function collectGeoIssues(body: string): GeoIssue[] {
  let tree: ReturnType<typeof mdxComponentParser.parse>;
  try {
    tree = mdxComponentParser.parse(body);
  } catch {
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
  body: string,
  recognized: Set<string>
): { line?: number; name: string }[] {
  let tree: ReturnType<typeof mdxComponentParser.parse>;
  try {
    tree = mdxComponentParser.parse(body);
  } catch {
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
  const routeIgnore = [...new Set([...ignore, ...ROUTE_INDEX_IGNORE_GLOBS])];
  const routeFiles = await glob(srcDir, ["**/*.mdx", "**/*.md"], routeIgnore);
  const routeSet = new Set(
    routeFiles.map((filePath) => routeFromFilePath(srcDir, filePath))
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

    // Flag components that won't flatten — they'd leak raw JSX into the agent
    // markdown. Walks the MDX AST, so JSX inside code fences (a `code` node, not
    // a JSX element) is correctly ignored.
    for (const { name, line } of collectUnflattenedComponents(
      body,
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
    for (const issue of collectGeoIssues(body)) {
      const fileLine = issue.line ? issue.line + bodyLineOffset : undefined;
      violations.push({
        file: relativeFile,
        kind: "content",
        severity: "warn",
        rule: issue.rule,
        message: `${issue.message}${fileLine ? ` (line ${fileLine})` : ""}`,
      });
    }

    try {
      const converted = await convertMdxToMarkdown(file, [
        remarkInclude,
        ...defaultRemarkPlugins,
      ]);
      const rendered = parseFrontmatter(converted.markdown);
      const currentFramework = deriveDocContext(file).framework;

      violations.push(
        ...validateDocUrls(
          collectFrontmatterUrls(rendered.data),
          relativeFile,
          kind,
          routeSet,
          currentFramework
        )
      );
      violations.push(
        ...validateDocUrls(
          collectMarkdownUrls(rendered.content),
          relativeFile,
          "content",
          routeSet,
          currentFramework
        )
      );
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

  let errorCount = 0;
  let warningCount = 0;
  for (const violation of violations) {
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

  return { violations, summary };
}

export type {
  DefaultChangelogFrontmatter,
  DefaultFrontmatter,
  DefaultMeta,
} from "./schema";
