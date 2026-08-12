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
import { normalizeDocsI18nConfig } from "../i18n";
import { normalizeDocsPath, toDocsUrlPath } from "../internal/docs-url";
import { resolveDocsNavigation } from "../llm";
import type { DocsNavigation, DocsNavigationGroup } from "../llm/readability";
import {
  derivationPathFilter,
  type NavigationOrigin,
  type ProjectDiagnostic,
  type ResolvedProject,
  type ResolvedProjectCollection,
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
   * urlPaths reachable through the tree or the ungrouped root fallback. The
   * manifest resolves over the pages the collection's include/exclude globs
   * admit — the file set `generate` stages, not the raw directory — so these
   * are exactly the routes the build ships.
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
 * The collection's include/exclude selection as the file filter
 * `resolveDocsNavigation` accepts — the mirror `generate` stages, tested at
 * the file level before locale selection, exactly like staging. `undefined`
 * when the collection declares no filter, so the unfiltered path is
 * untouched. Glob semantics live in `derivationPathFilter`, shared with nav
 * derivation.
 */
async function admittedFileFilter(
  collection: ReadableProjectCollection
): Promise<((absoluteFilePath: string) => boolean) | undefined> {
  const { filter } = await derivationPathFilter(
    collection,
    collection.contentDir
  );
  if (!filter) {
    return;
  }
  return (absoluteFilePath) =>
    filter(
      normalizeDocsPath(path.relative(collection.contentDir, absoluteFilePath))
    );
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
 * - **Every configured locale is validated**, because `generate` resolves
 *   the tree once per locale and rejects each locale's failures — a
 *   translation with locale-specific bad nav metadata fails the build while
 *   the default locale is clean, so checking only the default reported
 *   nothing for it.
 * - **Resolution reads the admitted file set, not the raw directory**,
 *   because `generate` stages a filtered mirror before resolving — against
 *   the raw view a curated entry naming an excluded page resolves fine here
 *   while the build fails on it as missing, excluded pages count as shipped,
 *   and every excluded page reads as unplaced.
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

  const filterFile = await admittedFileFilter(collection);

  const resolveConfig = {
    srcDir: path.dirname(contentDir),
    docsDirName: path.basename(contentDir),
    mounts,
    groups: mergedGroups,
    nav: collection.navigation,
    ...(project.config?.i18n ? { i18n: project.config.i18n } : {}),
    ...(filterFile ? { filterFile } : {}),
  };

  // The field named is the one the origin says produced the tree — an
  // inherited tree still lives on `navigation`, just authored elsewhere.
  const field = origin === "groups" ? "groups" : "navigation";
  const owner = project.config?.collections?.[collection.key]
    ? `collections.${collection.key}.${field}`
    : field;
  // With filters in play the entry may name a page that exists on disk but
  // that `include`/`exclude` keeps out of the staged mirror — say so, or
  // the "did not match a documentation page" message reads as a typo hunt.
  const fix = filterFile
    ? `Fix the entry \`${owner}\` points at — the page may exist but be removed by the collection's \`include\`/\`exclude\` — then re-run \`leadtype doctor\`.`
    : `Fix the entry \`${owner}\` points at, then re-run \`leadtype doctor\`.`;

  let manifest: DocsNavigation;
  try {
    // Resolving over the admitted set makes a curated reference to a
    // filtered-out page fail here exactly as it fails the build — against
    // the raw directory it resolved fine, so `doctor` said ok and `nav`
    // exited 0 for a project whose `generate` exits 1.
    manifest = await resolveDocsNavigation(resolveConfig);
  } catch (error) {
    diagnostics.push({
      id: "nav.unresolvable",
      level: "error",
      message: `collection "${collection.key}" navigation did not resolve: ${error instanceof Error ? error.message : String(error)}`,
      collection: collection.key,
      owner,
      fix,
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

  // `generate` validates every configured locale, not only the default: its
  // locale loop resolves the tree once per locale and rejects that locale's
  // unknown groups, so a `zh/` page declaring a group no config declares
  // fails the build while the default locale is clean. Resolving only the
  // default here reported no finding for exactly that page. Non-default
  // locales contribute findings only — the manifest, counts, and placement
  // drift stay the default locale's, which is the tree the commands present;
  // a localized finding already names its locale through the urlPath
  // (`/docs/zh/…`) or the diagnostic message.
  const localeUnknown: DocsNavigation["unknown"] = [];
  const i18n = normalizeDocsI18nConfig(project.config?.i18n);
  const extraLocales =
    i18n?.locales
      .map((locale) => locale.code)
      .filter((code) => code !== i18n.defaultLocale) ?? [];
  for (const locale of extraLocales) {
    try {
      const localized = await resolveDocsNavigation({
        ...resolveConfig,
        locale,
      });
      localeUnknown.push(...localized.unknown);
    } catch (error) {
      diagnostics.push({
        id: "nav.unresolvable",
        level: "error",
        message: `collection "${collection.key}" navigation did not resolve for locale "${locale}": ${error instanceof Error ? error.message : String(error)}`,
        collection: collection.key,
        owner,
        fix,
      });
    }
  }

  const routed = new Set<string>();
  const walk = (groups: DocsNavigationGroup[]): void => {
    for (const group of groups) {
      for (const page of group.pages) {
        routed.add(page.urlPath);
      }
      walk(group.children);
    }
  };
  walk(manifest.groups);
  for (const page of manifest.ungrouped) {
    routed.add(page.urlPath);
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
    // `ungrouped` already covers only admitted pages — the resolver read the
    // filtered file set — so an excluded page is never drift (`generate`
    // never stages it) while an admitted page that renders unrouted still is.
    unplaced = manifest.ungrouped
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
      unknownGroup: [...manifest.unknown, ...localeUnknown],
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
