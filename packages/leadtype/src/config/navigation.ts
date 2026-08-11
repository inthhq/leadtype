/**
 * One navigation manifest + drift computation, shared by every command.
 *
 * `resolveProject()` exists because `doctor` and `nav` hand-assembled the same
 * resolution pipeline and shipped the same bugs. The layer above it — resolve
 * each collection's navigation manifest, then compare it against the content
 * on disk — was still assembled per command, and diverged the same way:
 * `nav` dropped `i18n`, read only its own collection's groups, counted
 * excluded pages, and flagged inferred root pages as drift, while `doctor`
 * let a resolution error escape as a crash instead of a finding.
 *
 * So this module owns that layer. Given a resolved project it returns, per
 * collection, the manifest, its origin, the drift (unplaced, duplicated,
 * unknown-group pages), and any resolution failure as a diagnostic — and both
 * commands read the result, so a future command cannot re-diverge.
 */

import path from "node:path";
import { glob as fg } from "tinyglobby";
import { stripDocsExtension, toDocsUrlPath } from "../internal/docs-url";
import { resolveDocsNavigation } from "../llm";
import type {
  DocsNavigation,
  DocsNavigationGroup,
  DocsNavigationPage,
} from "../llm/readability";
import type {
  NavigationOrigin,
  ProjectDiagnostic,
  ResolvedProject,
  ResolvedProjectCollection,
} from "./project";

/** A collection whose content directory resolved — see the project diagnostics
 * for the ones that did not. */
export type ReadableProjectCollection = ResolvedProjectCollection & {
  contentDir: string;
};

export type NavigationDrift = {
  /** Pages on disk that no curated entry places. */
  unplaced: string[];
  /** Pages a curated entry names more than once. */
  duplicate: string[];
  /** Pages declaring a `group:` slug no config declares. */
  unknownGroup: { urlPath: string; slug: string }[];
};

export type CollectionNavigation = {
  collectionKey: string;
  /** Where the tree came from. */
  origin: NavigationOrigin;
  /** Absent when resolution failed — see {@link diagnostics}. */
  manifest?: DocsNavigation;
  /** Distinct pages the manifest presents, after include/exclude filtering. */
  pageCount: number;
  /**
   * urlPaths reachable through the tree or the ungrouped root fallback,
   * restricted to the pages the collection's include/exclude globs admit —
   * the file set `generate` stages, not the raw directory.
   */
  routedUrlPaths: string[];
  /** The manifest's top-level sections, one entry per group slug. */
  groups: { slug: string; title: string }[];
  drift: NavigationDrift;
  /**
   * Resolution failures — a pin that matches nothing, a page reference that
   * resolves to no file. Diagnostics, not exceptions: `doctor` reports them
   * as findings while `nav` fails on them, and only the caller knows which.
   */
  diagnostics: ProjectDiagnostic[];
};

export type ProjectNavigation = {
  /** One entry per collection with a readable content directory. */
  collections: CollectionNavigation[];
  /** The single shared origin, or `"mixed"` when collections disagree. */
  origin: NavigationOrigin | "mixed" | null;
  /**
   * Section titles across collections, deduped by slug. Merged declared
   * groups reach every collection's manifest (membership is pure slug
   * matching), so without the dedupe N collections sharing M groups would
   * report N×M titles where `generate` emits one deduplicated list of M.
   */
  groups: string[];
  /** Distinct routed urlPaths across collections. */
  routedPages: number;
  /** Every collection's unplaced pages, in collection order. */
  unplaced: string[];
  /** Every collection's resolution diagnostics, in collection order. */
  diagnostics: ProjectDiagnostic[];
};

/**
 * The first error-level project diagnostic scoped to a collection. A command
 * about to present a collection's tree checks this first: an unreadable
 * source config or a missing checkout means whatever tree resolution falls
 * back to is precisely the wrong tree, presented as fine.
 */
export function findBlockingDiagnostic(
  project: ResolvedProject,
  collectionKey: string
): ProjectDiagnostic | undefined {
  return project.diagnostics.find(
    (entry) => entry.level === "error" && entry.collection === collectionKey
  );
}

/**
 * The page set a collection's include/exclude globs admit, as
 * extension-stripped paths relative to the content directory — the mirror
 * `generate` stages. `null` when the collection declares no filter, so the
 * caller can skip membership checks entirely.
 */
async function filteredPageSet(
  collection: ReadableProjectCollection
): Promise<Set<string> | null> {
  const filtered =
    (collection.include?.length ?? 0) > 0 ||
    (collection.exclude?.length ?? 0) > 0;
  if (!filtered) {
    return null;
  }
  const include =
    collection.include && collection.include.length > 0
      ? collection.include
      : ["**/*.{md,mdx}"];
  const files = await fg(include, {
    cwd: collection.contentDir,
    ignore: collection.exclude ?? [],
    onlyFiles: true,
  });
  return new Set(files.map((file) => stripDocsExtension(file)));
}

/**
 * Whether the collection's include/exclude globs reject a manifest page.
 * The globs match on-disk paths; a localized page's `relativePath` is its
 * output path, so check the logical path and its source-locale-prefixed
 * on-disk variant too.
 */
function isExcluded(page: DocsNavigationPage, admitted: Set<string>): boolean {
  const candidates = [page.relativePath];
  if (page.logicalPath) {
    candidates.push(page.logicalPath);
    if (page.sourceLocale) {
      candidates.push(`${page.sourceLocale}/${page.logicalPath}`);
    }
  }
  return !candidates.some((candidate) => admitted.has(candidate));
}

/**
 * Find pages a curated tree lists more than once.
 *
 * Duplicates are easy to author by accident once expansions are in play: a
 * page named explicitly *and* swept up by a sibling include appears twice in
 * the sidebar and twice in `llms.txt`.
 */
function findDuplicates(manifest: DocsNavigation): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const walk = (groups: DocsNavigationGroup[]): void => {
    for (const group of groups) {
      for (const page of group.pages) {
        if (seen.has(page.urlPath)) {
          duplicates.add(page.urlPath);
        } else {
          seen.add(page.urlPath);
        }
      }
      walk(group.children);
    }
  };
  walk(manifest.groups);
  return [...duplicates].sort();
}

/**
 * Resolve one collection's navigation manifest and compute its drift.
 *
 * The tree and origin come from `resolveProject` — authored, inherited, or
 * derived; this reads them rather than re-deciding. Everything both commands
 * used to assemble by hand happens here, once:
 *
 * - **Groups are merged across collections**, because `generate` merges them
 *   globally before resolving — membership is pure slug matching, so a page
 *   whose `group:` a sibling collection declares resolves there and would
 *   read as unknown here.
 * - **i18n is forwarded**, because without it each translation resolves as
 *   its own page — and a default locale living under its own directory makes
 *   every literal nav entry miss outright.
 * - **Counts and drift respect include/exclude**, because
 *   `resolveDocsNavigation` reads the whole directory while `generate`
 *   stages a filtered mirror first — the raw view counts pages the build
 *   never ships and reports every excluded page as unplaced.
 * - **Resolution errors come back as diagnostics** with a stable id, so a
 *   pin typo is a finding a report can carry, not a crash.
 */
export async function resolveCollectionNavigation(
  project: ResolvedProject,
  collection: ReadableProjectCollection
): Promise<CollectionNavigation> {
  const contentDir = collection.contentDir;
  const origin = collection.navigationOrigin;
  const diagnostics: ProjectDiagnostic[] = [];

  const mounts = [
    { pathPrefix: "", urlPrefix: collection.routePrefix },
    ...(collection.mounts ?? []),
  ];
  const mergedGroups = project.collections.flatMap(
    (entry) => entry.groups ?? []
  );

  let manifest: DocsNavigation;
  try {
    manifest = await resolveDocsNavigation({
      srcDir: path.dirname(contentDir),
      docsDirName: path.basename(contentDir),
      mounts,
      groups: mergedGroups,
      nav: collection.navigation,
      ...(project.config?.i18n ? { i18n: project.config.i18n } : {}),
    });
  } catch (error) {
    // The field named is the one the origin says produced the tree — an
    // inherited tree still lives on `navigation`, just authored elsewhere.
    const field = origin === "groups" ? "groups" : "navigation";
    const owner = project.config?.collections?.[collection.key]
      ? `collections.${collection.key}.${field}`
      : field;
    diagnostics.push({
      id: "nav.unresolvable",
      level: "error",
      message: `collection "${collection.key}" navigation did not resolve: ${error instanceof Error ? error.message : String(error)}`,
      collection: collection.key,
      owner,
      fix: `Fix the entry \`${owner}\` points at, then re-run \`leadtype doctor\`.`,
    });
    return {
      collectionKey: collection.key,
      origin,
      pageCount: 0,
      routedUrlPaths: [],
      groups: [],
      drift: { unplaced: [], duplicate: [], unknownGroup: [] },
      diagnostics,
    };
  }

  const admitted = await filteredPageSet(collection);
  const excluded = (page: DocsNavigationPage): boolean =>
    admitted !== null && isExcluded(page, admitted);

  const routed = new Set<string>();
  const walk = (groups: DocsNavigationGroup[]): void => {
    for (const group of groups) {
      for (const page of group.pages) {
        if (!excluded(page)) {
          routed.add(page.urlPath);
        }
      }
      walk(group.children);
    }
  };
  walk(manifest.groups);
  for (const page of manifest.ungrouped) {
    if (!excluded(page)) {
      routed.add(page.urlPath);
    }
  }

  // A page the curated tree never mentions still renders — it falls back to
  // the root of `ungrouped`. That is the signal worth reporting: the page
  // appears at the root of the sidebar and llms.txt by default rather than by
  // decision. Only meaningful when someone wrote the tree — here or in the
  // source repo it was inherited from; a derived tree places everything by
  // construction, so its root pages (the index of every inferred project) are
  // placements, not drift. And only computable when every root entry is a
  // literal path: an include glob at the root expands to a set this
  // comparison cannot reconstruct.
  const curated = origin === "explicit" || origin === "inherited";
  const rootEntries = curated ? (collection.navigation ?? []) : [];
  const rootIsLiteral = rootEntries.every(
    (entry) => typeof entry === "string" || !("include" in entry)
  );
  let unplaced: string[] = [];
  if (curated && rootIsLiteral) {
    const placedAtRoot = new Set(
      rootEntries
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => toDocsUrlPath(entry, mounts))
    );
    // Restricting to the admitted set keeps this check alive for filtered
    // collections instead of disabling it: an excluded page is not drift —
    // `generate` never stages it — while an admitted page that renders
    // unrouted still is.
    unplaced = manifest.ungrouped
      .filter((page) => !excluded(page))
      .map((page) => page.urlPath)
      .filter((urlPath) => !placedAtRoot.has(urlPath));
  }

  return {
    collectionKey: collection.key,
    origin,
    manifest,
    pageCount: routed.size,
    routedUrlPaths: [...routed],
    groups: manifest.groups.map((group) => ({
      slug: group.slug,
      title: group.title,
    })),
    drift: {
      unplaced,
      duplicate: findDuplicates(manifest),
      unknownGroup: manifest.unknown,
    },
    diagnostics,
  };
}

/** Resolve every readable collection's navigation and aggregate the result. */
export async function resolveProjectNavigation(
  project: ResolvedProject
): Promise<ProjectNavigation> {
  const readable = project.collections.filter(
    (entry): entry is ReadableProjectCollection => Boolean(entry.contentDir)
  );
  const collections: CollectionNavigation[] = [];
  for (const collection of readable) {
    collections.push(await resolveCollectionNavigation(project, collection));
  }

  const origins = new Set(collections.map((entry) => entry.origin));
  let origin: NavigationOrigin | "mixed" | null = null;
  if (origins.size === 1) {
    origin = [...origins][0] as NavigationOrigin;
  } else if (origins.size > 1) {
    origin = "mixed";
  }
  const groups: string[] = [];
  const seenSlugs = new Set<string>();
  for (const entry of collections) {
    for (const group of entry.groups) {
      if (seenSlugs.has(group.slug)) {
        continue;
      }
      seenSlugs.add(group.slug);
      groups.push(group.title);
    }
  }

  return {
    collections,
    origin,
    groups,
    routedPages: new Set(collections.flatMap((entry) => entry.routedUrlPaths))
      .size,
    unplaced: collections.flatMap((entry) => entry.drift.unplaced),
    diagnostics: collections.flatMap((entry) => entry.diagnostics),
  };
}
