import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import * as v from "valibot";
import { convertMdxToMarkdown } from "../convert";
import {
  deriveDocContext,
  hasDocPlaceholder,
  normalizeDocsUrl,
  routeFromFilePath,
} from "../internal/docs-context";
import { defaultRemarkPlugins, remarkInclude } from "../remark";
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
  | "cross-framework-link";

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

export async function lintDocs(options: LintOptions): Promise<LintResult> {
  const {
    srcDir,
    changelogDir,
    ignore = DEFAULT_IGNORE_GLOBS,
    unknownFieldSeverity = "warn",
    schemas = {},
  } = options;

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
    const relativeFile = toRelative(srcDir, file);
    try {
      const raw = await readFile(file, "utf-8");
      const parsed = matter(raw);
      data = parsed.data as Record<string, unknown>;
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

    try {
      const converted = await convertMdxToMarkdown(file, [
        remarkInclude,
        ...defaultRemarkPlugins,
      ]);
      const rendered = matter(converted.markdown);
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
