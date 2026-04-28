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
  v.string(),
  v.check((value: string) => !Number.isNaN(new Date(value).getTime()), {
    message: "Must be an ISO-8601 date or parseable date string",
  } as never)
);

/**
 * Cross-framework page link used by the "Available in other SDKs" widget.
 * Matches the monorepo's `availableIn` schema at c15t-docs/schema/docs.ts.
 */
const availableInEntry = v.object({
  framework: v.string(),
  url: v.optional(v.string()),
  title: v.optional(v.string()),
});

/**
 * Default frontmatter schema for docs pages. Mirrors the fields the monorepo
 * actually *consumes* at render time (verified via grep in
 * apps/c15t-docs/src). Anything defined in the monorepo's schema but never
 * read (deprecatedSince, since, tocStyle as of 2026-04-17) is deliberately
 * omitted so the linter flags them as legacy cruft.
 *
 * Callers can override via `lintDocs({ schemas: { frontmatter: ... } })`.
 */
export const defaultFrontmatterSchema = v.object({
  title: v.pipe(v.string(), v.minLength(1, "must not be empty")),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),

  // Lifecycle
  deprecated: v.optional(v.boolean()),
  deprecatedReason: v.optional(v.string()),
  experimental: v.optional(v.boolean()),
  canary: v.optional(v.boolean()),
  new: v.optional(v.boolean()),
  draft: v.optional(v.boolean()),

  // Categorization
  tags: v.optional(v.array(v.string())),
  group: v.optional(v.union([v.string(), v.array(v.string())])),
  availableIn: v.optional(v.array(availableInEntry)),

  // Layout
  full: v.optional(v.boolean()),
  // Note: `lastModified` and `lastAuthor` are intentionally NOT in this
  // schema. They are auto-populated during convert via
  // `enrichFrontmatterFromGit` and should not be hand-authored — the linter
  // will flag any source-authored `lastModified` as unknown-field.
});

export type DefaultFrontmatter = v.InferOutput<typeof defaultFrontmatterSchema>;

/**
 * Default schema for changelog entries. Mirrors c15t-docs/schema/changelog.ts.
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
