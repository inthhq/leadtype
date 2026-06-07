import * as v from "valibot";

// Full SemVer 2.0.0 — accepts prerelease (-canary.1) and build metadata
// (+build.5) identifiers. See https://semver.org/#backusnaur-form-grammar-for-valid-semver-versions
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const semver = v.pipe(
  v.string(),
  v.regex(
    SEMVER_PATTERN,
    "Must be a valid semantic version (e.g. 1.2.3, 1.2.3-canary.1, 1.2.3+build.5)"
  )
);

const isoDate = v.pipe(
  v.union([v.string(), v.date()]),
  v.check(
    (value: Date | string) => !Number.isNaN(new Date(value).getTime()),
    "Must be an ISO-8601 date or parseable date string"
  )
);

const nonEmptyString = v.pipe(v.string(), v.minLength(1, "must not be empty"));

const variantEntry = v.object({
  value: nonEmptyString,
  label: v.optional(nonEmptyString),
  href: nonEmptyString,
  description: v.optional(v.string()),
});

const relatedEntry = v.object({
  title: nonEmptyString,
  href: nonEmptyString,
  description: v.optional(v.string()),
});

/**
 * Default frontmatter schema for docs pages. It covers the common fields
 * leadtype consumes for generation, linting, search, navigation, and agent
 * bundles while staying generic enough for any docs framework.
 *
 * Callers can override via `lintDocs({ schemas: { frontmatter: ... } })`.
 */
export const defaultFrontmatterSchema = v.object({
  title: nonEmptyString,
  description: v.optional(v.string()),
  icon: v.optional(v.string()),

  // Editorial page state. Release channels belong in build config or
  // transformers, not page frontmatter.
  status: v.optional(v.picklist(["new", "updated", "experimental"])),
  deprecated: v.optional(nonEmptyString),

  // Categorization
  tags: v.optional(v.array(v.string())),
  group: v.optional(v.union([v.string(), v.array(v.string())])),
  // Search visibility. `search: false` excludes a page from public search and
  // answer citations; `search: true` opts `shared`/`_shared` routes back in.
  search: v.optional(v.boolean()),
  // Stable publication date for feeds. Use `lastModified` via `--enrich-git`
  // only when the feed should track source edits instead of a fixed publish date.
  date: v.optional(isoDate),
  variants: v.optional(v.array(variantEntry)),
  related: v.optional(v.array(relatedEntry)),
  /**
   * Sidebar ordering within a group. Lower numbers come first. Pages
   * without `order` sort alphabetically by URL path **after** explicitly
   * ordered pages, so you can pin a few key pages and leave the rest as
   * default. Conventionally numbered in tens (10, 20, 30) to leave room
   * for insertions. Must be an integer — fractional orders are rejected
   * by lint.
   */
  order: v.optional(v.pipe(v.number(), v.integer())),

  // Layout
  full: v.optional(v.boolean()),
  // Note: `lastModified` and `lastAuthor` are intentionally NOT in this
  // schema. They are auto-populated during convert via
  // `enrichFrontmatterFromGit` and should not be hand-authored — the linter
  // will flag any source-authored `lastModified` as unknown-field.
});

export type DefaultFrontmatter = v.InferOutput<typeof defaultFrontmatterSchema>;

/**
 * Default schema for changelog entries.
 * Enable via `lintDocs({ changelogDir: "./content/changelog" })`.
 */
export const defaultChangelogFrontmatterSchema = v.object({
  title: v.pipe(v.string(), v.minLength(1)),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  version: semver,
  date: isoDate,
  type: v.optional(
    v.picklist(["release", "improvement", "retired", "deprecation"])
  ),
  tags: v.optional(v.array(v.string())),
  canary: v.optional(v.boolean()),
  authors: v.optional(v.union([v.string(), v.array(v.string())])),
  draft: v.optional(v.boolean()),
});

export type DefaultChangelogFrontmatter = v.InferOutput<
  typeof defaultChangelogFrontmatterSchema
>;

/**
 * Default schema for Fumadocs-style `meta.json` files that drive sidebar
 * ordering and section labels. `pages` is the only field Fumadocs requires;
 * everything else is optional.
 */
export const defaultMetaSchema = v.object({
  title: v.optional(v.pipe(v.string(), v.minLength(1))),
  pages: v.array(v.string()),
  root: v.optional(v.boolean()),
  icon: v.optional(v.string()),
  defaultOpen: v.optional(v.boolean()),
  nav: v.optional(
    v.object({
      sidebar: v.optional(v.picklist(["section", "combined"])),
      label: v.optional(v.string()),
      mode: v.optional(v.string()),
    })
  ),
});

export type DefaultMeta = v.InferOutput<typeof defaultMetaSchema>;

/**
 * Extract the set of allowed top-level keys from a valibot object schema.
 * Used to flag unknown fields as warnings without making the schema itself
 * strict (which would turn unknowns into hard errors).
 */
export function allowedKeys(
  schema: v.ObjectSchema<
    v.ObjectEntries,
    v.ErrorMessage<v.ObjectIssue> | undefined
  >
): Set<string> {
  return new Set(Object.keys(schema.entries));
}
