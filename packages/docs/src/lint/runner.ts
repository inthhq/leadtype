import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import * as v from "valibot";
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
  | "parse-error";

export type LintViolation = {
  file: string;
  kind: "frontmatter" | "changelog" | "meta";
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
   * like `shared/**` or orphan drafts. Matched against POSIX-style relative
   * paths. Default: ["**\/shared/**"]
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
  "**/_partials/**",
  "**/node_modules/**",
];

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

  const violations: LintViolation[] = [];

  const mdxFiles = await glob(srcDir, ["**/*.mdx", "**/*.md"], ignore);
  const metaFiles = await glob(srcDir, ["**/meta.json"], ignore);
  const filesScanned = mdxFiles.length + metaFiles.length;

  for (const file of mdxFiles) {
    let data: Record<string, unknown>;
    try {
      const raw = await readFile(file, "utf-8");
      const parsed = matter(raw);
      data = parsed.data as Record<string, unknown>;
    } catch (error) {
      violations.push({
        file: toRelative(srcDir, file),
        kind: "frontmatter",
        severity: "error",
        rule: "parse-error",
        message: `failed to parse frontmatter: ${String(error)}`,
      });
      continue;
    }

    const isChangelog = isUnderDir(file, changelogDir);
    const schemaToUse = isChangelog ? changelogSchema : frontmatterSchema;
    const kind: LintViolation["kind"] = isChangelog
      ? "changelog"
      : "frontmatter";

    violations.push(
      ...validate(
        schemaToUse,
        data,
        toRelative(srcDir, file),
        kind,
        unknownFieldSeverity
      )
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

  const summary: LintSummary = {
    filesScanned,
    errors: violations.filter((violation) => violation.severity === "error")
      .length,
    warnings: violations.filter((violation) => violation.severity === "warn")
      .length,
  };

  return { violations, summary };
}

export type {
  DefaultChangelogFrontmatter,
  DefaultFrontmatter,
  DefaultMeta,
} from "./schema";
