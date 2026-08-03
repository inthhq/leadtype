/**
 * Derived defaults for the common path.
 *
 * Leadtype's advanced controls exist because c15t-scale multi-repo docs need
 * them. A one-page local docs site does not, and making someone learn the
 * `navigation` tree and the `llms.sections` block model before they have
 * written anything is the wrong point on the adoption curve.
 *
 * So: when a value is absent, derive it from a source of truth that already
 * exists — `package.json`, the content tree, the resolved navigation. Three
 * rules hold every derivation together:
 *
 *   1. **Explicit always wins.** Inference only ever fills a gap; it never
 *      merges with, reorders, or rewrites an authored value.
 *   2. **Deterministic.** Ordering comes from frontmatter and paths, never from
 *      filesystem enumeration order, so two machines derive the same tree.
 *   3. **Explainable.** Every derived value reports what it was derived from
 *      and which field to set to take control.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob as fg } from "tinyglobby";
import { parseFrontmatter } from "../internal/frontmatter";
import type {
  CuratedLink,
  DocsNavEntry,
  DocsNavNode,
  LlmsBlock,
  ProductInfo,
} from "../llm/llm";
import type { DocsNavigation } from "../llm/readability";

/** How many starting points a derived `llms.txt` links block lists. */
const DERIVED_STARTING_POINTS_LIMIT = 12;
/** Read frontmatter in batches so a large tree doesn't exhaust file handles. */
const FRONTMATTER_READ_BATCH_SIZE = 64;
const WORD_SEPARATORS = /[-_]+/g;
const FIRST_LETTER = /\b\w/g;
const DOC_GLOB = "**/*.{md,mdx}";
const DOC_EXTENSION = /\.(md|mdx)$/;

/**
 * One value Leadtype derived rather than read from config. Surfaced by
 * `generate --explain` and reusable by any other diagnostic.
 */
export type InferredValue = {
  /** Canonical config field this stands in for, e.g. `navigation`. */
  field: string;
  /** What it was derived from, in one line. */
  derivedFrom: string;
  /** A short description of the derived value, for human output. */
  summary: string;
  /** How to take control of it. */
  makeExplicit: string;
};

/**
 * Something the derivation could not decide cleanly. Distinct from an
 * `InferredValue`: these are worth a warning because the result may not be what
 * the author wants.
 */
export type InferenceWarning = {
  field: string;
  message: string;
  hint: string;
};

export type InferenceReport = {
  values: InferredValue[];
  warnings: InferenceWarning[];
};

export function emptyInferenceReport(): InferenceReport {
  return { values: [], warnings: [] };
}

function titleize(segment: string): string {
  return segment
    .replace(WORD_SEPARATORS, " ")
    .replace(FIRST_LETTER, (char) => char.toUpperCase());
}

type ContentPage = {
  /** Path relative to the docs dir, without extension, POSIX separators. */
  relativePath: string;
  /** Directory portion, "" for a root page. */
  dir: string;
  /** Final segment, without extension. */
  name: string;
  title?: string;
  description?: string;
  /** Frontmatter `order`, when numeric. */
  order?: number;
};

async function readContentPages(
  docsDir: string,
  skip: ReadonlySet<string>
): Promise<ContentPage[]> {
  const files = (
    await fg(DOC_GLOB, { absolute: false, cwd: docsDir, onlyFiles: true })
  )
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => !skip.has(file.replace(DOC_EXTENSION, "")))
    // Sort before reading so batching — and therefore any later tie-break —
    // never depends on the order the filesystem happened to return.
    .sort((left, right) => left.localeCompare(right));

  const pages: ContentPage[] = [];
  for (
    let index = 0;
    index < files.length;
    index += FRONTMATTER_READ_BATCH_SIZE
  ) {
    const batch = files.slice(index, index + FRONTMATTER_READ_BATCH_SIZE);
    const parsed = await Promise.all(
      batch.map(async (file) => {
        const raw = await readFile(path.join(docsDir, file), "utf8");
        const { data } = parseFrontmatter(raw);
        const relativePath = file.replace(DOC_EXTENSION, "");
        const segments = relativePath.split("/");
        const name = segments.pop() ?? relativePath;
        const title =
          typeof data.title === "string" && data.title.trim().length > 0
            ? data.title.trim()
            : undefined;
        const description =
          typeof data.description === "string" &&
          data.description.trim().length > 0
            ? data.description.trim()
            : undefined;
        const order =
          typeof data.order === "number" && Number.isFinite(data.order)
            ? data.order
            : undefined;
        return {
          relativePath,
          dir: segments.join("/"),
          name,
          ...(title ? { title } : {}),
          ...(description ? { description } : {}),
          ...(order === undefined ? {} : { order }),
        } satisfies ContentPage;
      })
    );
    pages.push(...parsed);
  }
  return pages;
}

/**
 * Order pages within one section: an `index` page first (it is the section's
 * landing page), then explicit frontmatter `order`, then path. Pages without
 * `order` sort after pages with one, so adding `order: 1` to a single page
 * promotes it without renumbering everything else.
 */
function compareContentPages(left: ContentPage, right: ContentPage): number {
  const leftIsIndex = left.name === "index" ? 0 : 1;
  const rightIsIndex = right.name === "index" ? 0 : 1;
  if (leftIsIndex !== rightIsIndex) {
    return leftIsIndex - rightIsIndex;
  }
  const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

export type InferNavigationResult = {
  navigation: DocsNavEntry[];
  report: InferenceReport;
  /** Every page found, ordered as the derived navigation lists them. */
  pages: ContentPage[];
};

/**
 * Derive a nested navigation tree from the content directory.
 *
 * Root-level pages become ordered root entries; each top-level directory
 * becomes one section titled from its `index` page's frontmatter, falling back
 * to a titleized directory name. Directories nested deeper than one level are
 * listed within their top-level section by relative path rather than becoming
 * their own nodes — a derived tree that mirrors an arbitrarily deep filesystem
 * produces a sidebar nobody chose.
 */
export async function inferNavigationFromContent(
  docsDir: string,
  options: {
    /**
     * Docs-relative paths (with or without extension) to leave out. Pages that
     * another producer already contributed navigation for — generated OpenAPI
     * reference pages, for one — must not also be derived from the filesystem,
     * or both trees claim the same slug.
     */
    exclude?: readonly string[];
  } = {}
): Promise<InferNavigationResult> {
  const skip = new Set(
    (options.exclude ?? []).map((entry) =>
      entry.split(path.sep).join("/").replace(DOC_EXTENSION, "")
    )
  );
  const pages = await readContentPages(docsDir, skip);
  const report = emptyInferenceReport();

  if (pages.length === 0) {
    return { navigation: [], report, pages };
  }

  const rootPages: ContentPage[] = [];
  const sections = new Map<string, ContentPage[]>();
  for (const page of pages) {
    if (page.dir === "") {
      rootPages.push(page);
      continue;
    }
    const sectionKey = page.dir.split("/")[0] ?? page.dir;
    const bucket = sections.get(sectionKey) ?? [];
    bucket.push(page);
    sections.set(sectionKey, bucket);
  }

  rootPages.sort(compareContentPages);
  const navigation: DocsNavEntry[] = rootPages.map((page) => page.name);

  const orderedSections = [...sections.entries()].sort(([left], [right]) => {
    // A section inherits its position from its highest-priority page, so
    // `order: 1` on a section's index page moves the whole section.
    const leftPages = [...(sections.get(left) ?? [])].sort(compareContentPages);
    const rightPages = [...(sections.get(right) ?? [])].sort(
      compareContentPages
    );
    const leftOrder = leftPages[0]?.order ?? Number.POSITIVE_INFINITY;
    const rightOrder = rightPages[0]?.order ?? Number.POSITIVE_INFINITY;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right);
  });

  for (const [sectionKey, sectionPages] of orderedSections) {
    const ordered = [...sectionPages].sort(compareContentPages);
    const sectionIndex = ordered.find(
      (page) => page.relativePath === `${sectionKey}/index`
    );
    const node: DocsNavNode = {
      title: sectionIndex?.title ?? titleize(sectionKey),
      base: sectionKey,
      pages: ordered.map((page) =>
        page.relativePath.slice(sectionKey.length + 1)
      ),
    };
    if (sectionIndex?.description) {
      node.description = sectionIndex.description;
    }
    navigation.push(node);
  }

  const untitled = pages.filter((page) => page.title === undefined);
  if (untitled.length > 0) {
    report.warnings.push({
      field: "navigation",
      message: `${untitled.length} page${untitled.length === 1 ? "" : "s"} have no frontmatter \`title\`, so derived navigation labels come from their filenames (${untitled
        .slice(0, 3)
        .map((page) => page.relativePath)
        .join(", ")}${untitled.length > 3 ? ", …" : ""})`,
      hint: "Add `title:` to each page's frontmatter, or author `navigation` explicitly to set the labels yourself.",
    });
  }

  report.values.push({
    field: "navigation",
    derivedFrom: "the content tree and page frontmatter",
    summary: `${navigation.length} top-level entr${navigation.length === 1 ? "y" : "ies"} across ${pages.length} page${pages.length === 1 ? "" : "s"}`,
    makeExplicit:
      "Set `navigation` in your docs config to curate order, titles, and grouping.",
  });

  return { navigation, report, pages };
}

function collectNavigationPages(
  navigation: DocsNavigation
): { urlPath: string; title: string; description: string }[] {
  const collected: { urlPath: string; title: string; description: string }[] =
    [];
  const walk = (groups: DocsNavigation["groups"]): void => {
    for (const group of groups) {
      for (const page of group.pages) {
        collected.push({
          urlPath: page.urlPath,
          title: page.title,
          description: page.description,
        });
      }
      walk(group.children);
    }
  };
  // Root pages first — they are the entry points a reader hits before any
  // section — then each section in resolved order.
  for (const page of navigation.ungrouped) {
    collected.push({
      urlPath: page.urlPath,
      title: page.title,
      description: page.description,
    });
  }
  walk(navigation.groups);
  return collected;
}

/**
 * Derive the `llms.txt` body from product identity plus resolved navigation.
 *
 * One `links` block of starting points, in resolved navigation order. That is
 * the llms.txt convention and it is the block an author would otherwise write
 * by hand, one entry at a time, duplicating what navigation already says.
 */
export function inferLlmsBlocks(config: {
  product: ProductInfo;
  navigation: DocsNavigation;
  limit?: number;
}): { blocks: LlmsBlock[]; report: InferenceReport } {
  const report = emptyInferenceReport();
  const limit = config.limit ?? DERIVED_STARTING_POINTS_LIMIT;
  const pages = collectNavigationPages(config.navigation);

  if (pages.length === 0) {
    return { blocks: [], report };
  }

  const selected = pages.slice(0, limit);
  const links: CuratedLink[] = selected.map((page) => ({
    urlPath: page.urlPath,
    ...(page.title ? { title: page.title } : {}),
    ...(page.description ? { description: page.description } : {}),
  }));

  if (pages.length > limit) {
    report.warnings.push({
      field: "llms.sections",
      message: `derived starting points list the first ${limit} of ${pages.length} pages in navigation order`,
      hint: "Set `llms.sections` to choose which pages an agent should start from — the full page list is always in the sitemap and llms-full.txt.",
    });
  }

  report.values.push({
    field: "llms.sections",
    derivedFrom: "product identity and resolved navigation",
    summary: `a "Best Starting Points" block with ${links.length} link${links.length === 1 ? "" : "s"}`,
    makeExplicit:
      "Set `llms.sections` in your docs config to write the llms.txt body yourself.",
  });

  return {
    blocks: [{ type: "links", heading: "Best Starting Points", links }],
    report,
  };
}

/**
 * Derive product identity from `package.json`. Returns `undefined` for a field
 * the manifest does not supply, so callers can tell "derived" from "defaulted".
 */
export async function inferProductFromPackageJson(
  srcDir: string
): Promise<{ name?: string; tagline?: string }> {
  try {
    const raw = await readFile(path.join(srcDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(typeof parsed.name === "string" && parsed.name.length > 0
        ? { name: parsed.name }
        : {}),
      ...(typeof parsed.description === "string" &&
      parsed.description.length > 0
        ? { tagline: parsed.description }
        : {}),
    };
  } catch {
    // No manifest, or an unreadable one — the caller falls back to documented
    // defaults. A missing package.json is not an error for a docs-only repo.
    return {};
  }
}

export function mergeInferenceReports(
  ...reports: InferenceReport[]
): InferenceReport {
  return {
    values: reports.flatMap((report) => report.values),
    warnings: reports.flatMap((report) => report.warnings),
  };
}

/** Human-readable inference summary for `generate --explain`. */
export function formatInferenceReport(report: InferenceReport): string {
  if (report.values.length === 0 && report.warnings.length === 0) {
    return "Nothing was inferred — every value came from your config.\n";
  }
  const lines: string[] = ["Inferred values:"];
  for (const value of report.values) {
    lines.push(
      `  ${value.field}`,
      `    from:  ${value.derivedFrom}`,
      `    value: ${value.summary}`,
      `    fix:   ${value.makeExplicit}`
    );
  }
  if (report.warnings.length > 0) {
    lines.push("", "Ambiguous inference:");
    for (const warning of report.warnings) {
      lines.push(
        `  ${warning.field}: ${warning.message}`,
        `    ${warning.hint}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
