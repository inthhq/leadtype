/**
 * `leadtype doctor` — explain the resolved project before doing work.
 *
 * `generate`, `sync`, `lint`, and `score` each answer a question about a
 * project by doing something to it. None of them answers "what *is* this
 * project, and why?" — which config file was found, whether it is local or
 * multi-repo, which values were authored versus inherited versus inferred,
 * which collections share a clone, what routes will exist, and which command
 * fixes whatever is currently wrong.
 *
 * Doctor is read-only by construction: it never clones, refreshes, writes, or
 * generates. Everything it reports comes from the same config loader and
 * resolvers the other commands use, so a clean doctor run and a clean
 * `generate` run cannot disagree.
 */

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { glob as fg } from "tinyglobby";
import { inferNavigationFromContent } from "../config/infer";
import { inheritCollectionSourceConfigs } from "../config/inherit";
import { serializeResolvedConfig } from "../config/types";
import { toDocsUrlPath } from "../internal/docs-url";
import type { DocsCollection } from "../llm";
import { resolveDocsNavigation } from "../llm";
import { readSyncManifest, resolveCollection } from "../sync/sync";
import { type LoadedDocsConfig, loadDocsConfig } from "./generate";

export type DoctorIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

export type DoctorArgs = {
  srcDir: string;
  docsDirs: string[];
  outDir: string;
  json: boolean;
  help: boolean;
};

/**
 * A finding. `id` is stable across releases so `--json` consumers can key on
 * it; `message` is what a person reads and may be reworded freely.
 */
export type DoctorIssue = {
  id: string;
  level: "error" | "warn" | "info";
  message: string;
  /** Canonical config field or file that owns the problem. */
  owner?: string;
  /** A concrete next command. */
  fix?: string;
};

export type DoctorReport = {
  ok: boolean;
  config: {
    path?: string;
    mode: "single-source" | "multi-source" | "none";
    deprecations: { field: string; replacement: string }[];
    /** Per-field origin for top-level config values. */
    provenance: Record<string, unknown>;
  };
  sources: {
    id: string;
    kind: "local" | "git";
    repository?: string;
    ref?: string;
    refKind?: "commit" | "mutable";
    cacheDir?: string;
    /** `null` for local sources. */
    syncedCommit?: string | null;
    collections: string[];
  }[];
  collections: {
    key: string;
    routePrefix: string;
    contentDir?: string;
    pageCount?: number;
    provenance: Record<string, unknown>;
  }[];
  navigation: {
    /** Where the tree came from. */
    origin: "explicit" | "inherited" | "inferred" | "groups";
    groups: string[];
    routedPages: number;
    unrepresentedPages: string[];
  } | null;
  outputs: {
    root: string;
    present: string[];
    missing: string[];
    /** Artifacts older than the newest source file or the config. */
    stale: string[];
  };
  integrations: {
    framework?: string;
    surfaces: string[];
  };
  issues: DoctorIssue[];
};

const DOCTOR_USAGE = `leadtype doctor — explain the resolved project and its health

Usage:
  leadtype doctor [options]

Reports which config was found, whether the project is local or multi-repo,
where each value came from, which collections share a git acquisition, what
routes will exist, and which artifacts are present or stale.

Read-only: never clones, refreshes, writes, or generates.

Options:
  --src <dir>        Project root (default: .)
  --docs-dir <dir>   Docs source folder relative to --src (default: docs). Repeatable.
  --out <dir>        Output root to inspect (default: public)
  --json             Machine-readable report with stable issue ids
  -h, --help         Show this help

Exit codes:
  0  No errors (warnings may still be reported)
  1  At least one error — a required input is missing or invalid
  2  CLI usage error
`;

export function getDoctorUsage(): string {
  return DOCTOR_USAGE;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseDoctorArgs(argv: string[]): DoctorArgs {
  const args: DoctorArgs = {
    srcDir: ".",
    docsDirs: [],
    outDir: "public",
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--src") {
      args.srcDir = readValue(argv, ++i, "--src");
    } else if (arg === "--docs-dir") {
      args.docsDirs.push(readValue(argv, ++i, "--docs-dir"));
    } else if (arg === "--out") {
      args.outDir = readValue(argv, ++i, "--out");
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg) {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return args;
}

/** Site-mode artifacts a healthy generated output root carries. */
const EXPECTED_SITE_ARTIFACTS = [
  "llms.txt",
  "llms-full.txt",
  "sitemap.xml",
  "sitemap.md",
  "robots.txt",
  path.join("docs", "search-index.json"),
] as const;

const FRAMEWORK_MARKERS: { dependency: string; label: string }[] = [
  { dependency: "next", label: "Next.js" },
  { dependency: "astro", label: "Astro" },
  { dependency: "nuxt", label: "Nuxt" },
  { dependency: "@sveltejs/kit", label: "SvelteKit" },
  { dependency: "@tanstack/react-start", label: "TanStack Start" },
  { dependency: "fumadocs-core", label: "Fumadocs" },
];

async function detectFramework(srcDir: string): Promise<string | undefined> {
  const packageJsonPath = path.join(srcDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return;
  }
  try {
    const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = {
      ...parsed.dependencies,
      ...parsed.devDependencies,
    };
    return FRAMEWORK_MARKERS.find((marker) => deps[marker.dependency])?.label;
  } catch {
    // A malformed package.json is the user's other problem, not doctor's.
    return;
  }
}

function enabledSurfaces(loaded: LoadedDocsConfig | null): string[] {
  const agents = loaded?.config.agents;
  const surfaces: string[] = [];
  if (agents?.mcp?.enabled) {
    surfaces.push("mcp");
  }
  if (agents?.nlweb?.enabled) {
    surfaces.push("nlweb");
  }
  if (agents?.skills?.docsSkill !== false) {
    surfaces.push("skills");
  }
  if (agents?.agentCard?.enabled !== false) {
    surfaces.push("agent-card");
  }
  if (agents?.robots) {
    surfaces.push(`robots:${agents.robots.policy ?? "balanced"}`);
  }
  if (loaded?.config.redirects) {
    surfaces.push("redirects");
  }
  if (loaded?.config.feeds?.length) {
    surfaces.push(`feeds:${loaded.config.feeds.length}`);
  }
  return surfaces;
}

async function newestMtime(paths: string[]): Promise<number> {
  let newest = 0;
  for (const filePath of paths) {
    try {
      const stats = await stat(filePath);
      newest = Math.max(newest, stats.mtimeMs);
    } catch {
      // Unreadable inputs simply don't contribute a timestamp.
    }
  }
  return newest;
}

type CollectionInspection = {
  key: string;
  routePrefix: string;
  contentDir?: string;
  pageCount?: number;
  files: string[];
};

/**
 * Resolve one collection's directory without touching the network, recording
 * why it isn't usable when it isn't. Mirrors what the runtime project does, so
 * doctor reports the same problem the app would hit.
 */
async function inspectCollection(
  key: string,
  authored: DocsCollection | undefined,
  routePrefix: string,
  configDir: string,
  fallbackDir: string,
  issues: DoctorIssue[]
): Promise<CollectionInspection> {
  let contentDir = fallbackDir;

  if (authored) {
    const resolved = resolveCollection(key, authored, configDir);
    contentDir = resolved.absoluteDir;
    if (resolved.remote) {
      const { repository, ref, cacheDir } = resolved.remote;
      if (!existsSync(path.join(cacheDir, ".git"))) {
        issues.push({
          id: "source.not-synced",
          level: "error",
          message: `collection "${key}" reads ${repository}@${ref}, which has no checkout at "${cacheDir}"`,
          owner: `collections.${key}.repository`,
          fix: "leadtype sync",
        });
        return { key, routePrefix, files: [] };
      }
      const manifest = await readSyncManifest(cacheDir);
      if (!manifest) {
        issues.push({
          id: "source.cache-unverifiable",
          level: "error",
          message: `the cache for collection "${key}" at "${cacheDir}" has no sync manifest, so its revision can't be verified`,
          owner: `collections.${key}.cacheDir`,
          fix: "leadtype sync --refresh",
        });
        return { key, routePrefix, files: [] };
      }
      if (manifest.repository !== repository || manifest.ref !== ref) {
        issues.push({
          id: "source.cache-stale",
          level: "error",
          message: `the cache for collection "${key}" holds ${manifest.repository}@${manifest.ref}, but the config asks for ${repository}@${ref}`,
          owner: `collections.${key}.ref`,
          fix: "leadtype sync --refresh",
        });
        return { key, routePrefix, files: [] };
      }
    }
  }

  if (!existsSync(contentDir)) {
    issues.push({
      id: "source.dir-missing",
      level: "error",
      message: `collection "${key}" points at "${contentDir}", which does not exist`,
      owner: authored ? `collections.${key}.dir` : "--docs-dir",
    });
    return { key, routePrefix, files: [] };
  }

  const include =
    authored?.include && authored.include.length > 0
      ? authored.include
      : ["**/*.{md,mdx}"];
  const files = await fg(include, {
    absolute: true,
    cwd: contentDir,
    ignore: authored?.exclude ?? [],
    onlyFiles: true,
  });

  if (files.length === 0) {
    issues.push({
      id: "collection.no-matches",
      level: "warn",
      message: `collection "${key}" matches no files in "${contentDir}"`,
      owner:
        authored?.include && authored.include.length > 0
          ? `collections.${key}.include`
          : `collections.${key}.dir`,
    });
  }

  return {
    key,
    routePrefix,
    contentDir,
    pageCount: files.length,
    files,
  };
}

export async function runDoctorCommand(
  argv: string[],
  io: DoctorIo
): Promise<number> {
  let args: DoctorArgs;
  try {
    args = parseDoctorArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n\n${DOCTOR_USAGE}`);
    return 2;
  }
  if (args.help) {
    io.stdout.write(DOCTOR_USAGE);
    return 0;
  }

  const srcDir = path.resolve(args.srcDir);
  const docsDirNames = args.docsDirs.length > 0 ? args.docsDirs : ["docs"];
  const docsDirs = docsDirNames.map((dir) => path.resolve(srcDir, dir));
  // Resolved against cwd, not `--src` — that is what `leadtype generate` does,
  // and the two commands taking the same flag differently is its own bug.
  const outDir = path.resolve(args.outDir);
  const issues: DoctorIssue[] = [];

  let loaded: LoadedDocsConfig | null = null;
  try {
    loaded = await loadDocsConfig({ cwd: srcDir, docsDirs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A config that can't load is the whole answer — every later check would
    // be reporting on a project that doesn't resolve.
    issues.push({
      id: "config.invalid",
      level: "error",
      message,
      fix: "Fix the config, then re-run `leadtype doctor`.",
    });
    return finish(
      io,
      args,
      {
        ok: false,
        config: { mode: "none", deprecations: [], provenance: {} },
        sources: [],
        collections: [],
        navigation: null,
        outputs: { root: outDir, present: [], missing: [], stale: [] },
        integrations: { surfaces: [] },
        issues,
      },
      srcDir
    );
  }

  if (!loaded) {
    issues.push({
      id: "config.missing",
      level: "warn",
      message: `no leadtype.config.* at "${srcDir}" and no docs.config.* in ${docsDirNames.join(", ")}`,
      fix: "leadtype init",
    });
  }

  const configDir = loaded ? path.dirname(loaded.path) : srcDir;
  const resolved = loaded?.resolved;

  for (const deprecation of resolved?.deprecations ?? []) {
    issues.push({
      id: "config.deprecated-field",
      level: "warn",
      message: `${deprecation.field} is deprecated`,
      owner: deprecation.field,
      fix: `Rename it to ${deprecation.replacement}.`,
    });
  }

  const collections: DoctorReport["collections"] = [];
  const inspections: CollectionInspection[] = [];
  for (const collection of resolved?.collections ?? []) {
    const authored = loaded?.config.collections?.[collection.key];
    const inspection = await inspectCollection(
      collection.key,
      authored,
      collection.routePrefix,
      configDir,
      docsDirs[0] ?? srcDir,
      issues
    );
    inspections.push(inspection);
    collections.push({
      key: collection.key,
      routePrefix: collection.routePrefix,
      ...(inspection.contentDir ? { contentDir: inspection.contentDir } : {}),
      ...(inspection.pageCount === undefined
        ? {}
        : { pageCount: inspection.pageCount }),
      provenance: collection.provenance,
    });
  }

  const sources: DoctorReport["sources"] = [];
  for (const source of resolved?.sources ?? []) {
    if (source.kind === "local") {
      sources.push({
        id: source.id,
        kind: "local",
        collections: source.collectionKeys,
      });
      continue;
    }
    const cacheDir = path.resolve(
      configDir,
      source.cacheDir ??
        path.join(".leadtype", "sources", `${source.repository}@${source.ref}`)
    );
    const manifest = existsSync(cacheDir)
      ? await readSyncManifest(cacheDir)
      : null;
    if (source.refKind === "mutable") {
      // An anonymous source is identified by repository@ref, which is not a
      // config path — point at the collection that declared the ref instead.
      const authoredName = source.id !== `${source.repository}#${source.ref}`;
      issues.push({
        id: "source.mutable-ref",
        level: "warn",
        message: `source "${source.id}" tracks mutable ref "${source.ref}", so a published build is not reproducible`,
        owner: authoredName
          ? `sources.${source.id}.ref`
          : `collections.${source.collectionKeys[0]}.ref`,
        fix: "Pin `ref` to a commit SHA or an immutable tag.",
      });
    }
    if (source.collectionKeys.length > 1) {
      issues.push({
        id: "source.shared-acquisition",
        level: "info",
        message: `source "${source.id}" is cloned once and read by ${source.collectionKeys.join(", ")}`,
      });
    }
    sources.push({
      id: source.id,
      kind: "git",
      repository: source.repository,
      ref: source.ref,
      refKind: source.refKind,
      cacheDir,
      syncedCommit: manifest?.commit ?? null,
      collections: source.collectionKeys,
    });
  }

  // Source-owned inheritance decides what the navigation actually *is* for a
  // pinned-source project, so doctor has to apply it before reporting — the
  // un-inherited config would say "inferred" for a project whose tree comes
  // from the source repo. Uses the same shared implementation generation does.
  const inherited = await applySourceInheritance({
    loaded,
    configDir,
    issues,
  });

  const navigation = await inspectNavigation({
    loaded,
    inherited,
    inspections,
    issues,
  });

  const outputs = await inspectOutputs({ outDir, loaded, inspections, issues });
  const framework = await detectFramework(srcDir);

  const report: DoctorReport = {
    ok: !issues.some((issue) => issue.level === "error"),
    config: {
      ...(loaded ? { path: loaded.path } : {}),
      mode: resolved?.mode ?? "none",
      deprecations: (resolved?.deprecations ?? []).map((entry) => ({
        field: entry.field,
        replacement: entry.replacement,
      })),
      provenance: resolved ? serializeResolvedConfig(resolved).provenance : {},
    },
    sources,
    collections,
    navigation,
    outputs,
    integrations: {
      ...(framework ? { framework } : {}),
      surfaces: enabledSurfaces(loaded),
    },
    issues,
  };

  return finish(io, args, report, srcDir);
}

type InheritedCollections = {
  /** Collections after source-owned config was merged in, keyed by id. */
  byKey: Record<string, DocsCollection>;
  /** Collection ids whose navigation came from their source repository. */
  inheritedNavigation: Set<string>;
};

/**
 * Merge each collection's source-owned config, when its cache is readable.
 *
 * Doctor is read-only and must keep reporting even when a source is unsynced,
 * so a failure here is a finding rather than a throw — the collection simply
 * reports on what the project config alone says.
 */
async function applySourceInheritance(input: {
  loaded: LoadedDocsConfig | null;
  configDir: string;
  issues: DoctorIssue[];
}): Promise<InheritedCollections> {
  const { loaded, configDir, issues } = input;
  const collections = loaded?.config.collections;
  const empty: InheritedCollections = {
    byKey: collections ?? {},
    inheritedNavigation: new Set<string>(),
  };
  if (
    !(
      collections &&
      Object.values(collections).some((entry) => entry.inheritConfig)
    )
  ) {
    return empty;
  }

  try {
    const byKey = await inheritCollectionSourceConfigs(collections, configDir);
    const inheritedNavigation = new Set<string>();
    for (const [key, collection] of Object.entries(byKey)) {
      if (
        collection.navigation !== undefined &&
        collections[key]?.navigation === undefined
      ) {
        inheritedNavigation.add(key);
      }
    }
    return { byKey, inheritedNavigation };
  } catch (error) {
    issues.push({
      id: "source.inherit-failed",
      level: "warn",
      message: `source-owned config could not be read: ${error instanceof Error ? error.message : String(error)}`,
      owner: "inheritConfig",
      fix: "leadtype sync",
    });
    return empty;
  }
}

/**
 * Resolve navigation the way the site and the artifacts both will, one
 * collection at a time, then merge. Reporting only the first collection would
 * make a multi-repo project look emptier than it is.
 */
async function inspectNavigation(input: {
  loaded: LoadedDocsConfig | null;
  inherited: InheritedCollections;
  inspections: CollectionInspection[];
  issues: DoctorIssue[];
}): Promise<DoctorReport["navigation"]> {
  const { loaded, inherited, inspections, issues } = input;
  const readable = inspections.filter((entry) => entry.contentDir);
  if (readable.length === 0) {
    return null;
  }

  const groups: string[] = [];
  const routed = new Set<string>();
  const unrepresented: string[] = [];
  const origins = new Set<NonNullable<DoctorReport["navigation"]>["origin"]>();

  for (const inspection of readable) {
    const contentDir = inspection.contentDir as string;
    const collection = loaded?.resolved.collections.find(
      (entry) => entry.key === inspection.key
    );
    const merged = inherited.byKey[inspection.key];
    const authoredNav = merged?.navigation ?? collection?.navigation;
    const authoredGroups = merged?.groups ?? collection?.groups;
    const isInherited = inherited.inheritedNavigation.has(inspection.key);

    let nav = authoredNav;
    if (authoredNav && authoredNav.length > 0) {
      origins.add(isInherited ? "inherited" : "explicit");
    } else if (authoredGroups && authoredGroups.length > 0) {
      origins.add("groups");
    } else {
      origins.add("inferred");
      nav = (await inferNavigationFromContent(contentDir)).navigation;
    }

    // A collection renders under its own route prefix, so its navigation is
    // resolved with its own mount — the same mapping the runtime project uses.
    const mounts = [
      { pathPrefix: "", urlPrefix: collection?.routePrefix ?? "/docs" },
      ...(collection?.mounts ?? []),
    ];
    const navigationOptions = {
      srcDir: path.dirname(contentDir),
      docsDirName: path.basename(contentDir),
      mounts,
    };

    const manifest = await resolveDocsNavigation({
      ...navigationOptions,
      groups: authoredGroups ?? [],
      nav,
    });

    for (const unknown of manifest.unknown) {
      issues.push({
        id: "nav.unknown-group",
        level: "error",
        message: `${unknown.urlPath} declares unknown group "${unknown.slug}"`,
        owner: `collections.${inspection.key}.groups`,
        fix: "Add the group to `groups`, or fix the page's `group:` frontmatter.",
      });
    }

    const walk = (nodes: typeof manifest.groups): void => {
      for (const group of nodes) {
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
    groups.push(...manifest.groups.map((group) => group.title));

    // A page the curated tree never mentions still renders — it falls back to
    // the root of `ungrouped`. That is the signal worth reporting on a curated
    // site: the page exists, appears at the root of the sidebar and llms.txt
    // by default rather than by decision, and nobody placed it.
    //
    // Only meaningful when curation was intended (an authored `navigation`),
    // and only computable when every root entry is a literal path — an include
    // glob expands to a page set doctor would have to re-derive to compare
    // against, so those configs skip the check instead of guessing.
    const rootEntries = authoredNav ?? [];
    const curatable =
      rootEntries.length > 0 &&
      rootEntries.every(
        (entry) => typeof entry === "string" || !("include" in entry)
      );
    if (curatable) {
      const placedAtRoot = new Set(
        rootEntries
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => toDocsUrlPath(entry, mounts))
      );
      for (const page of manifest.ungrouped) {
        if (!placedAtRoot.has(page.urlPath)) {
          unrepresented.push(page.urlPath);
        }
      }
    }
  }

  if (unrepresented.length > 0) {
    issues.push({
      id: "nav.unrepresented-page",
      level: "warn",
      message: `${unrepresented.length} page${unrepresented.length === 1 ? " is" : "s are"} absent from the curated navigation and fall back to the root: ${unrepresented.slice(0, 5).join(", ")}${unrepresented.length > 5 ? ", …" : ""}`,
      owner: "navigation",
      fix: "Place them in `navigation`, or remove the files.",
    });
  }

  const origin =
    origins.size === 1
      ? ([...origins][0] as NonNullable<DoctorReport["navigation"]>["origin"])
      : "explicit";

  return {
    origin,
    groups,
    routedPages: routed.size,
    unrepresentedPages: unrepresented,
  };
}

async function inspectOutputs(input: {
  outDir: string;
  loaded: LoadedDocsConfig | null;
  inspections: CollectionInspection[];
  issues: DoctorIssue[];
}): Promise<DoctorReport["outputs"]> {
  const { outDir, loaded, inspections, issues } = input;
  const present: string[] = [];
  const missing: string[] = [];
  for (const artifact of EXPECTED_SITE_ARTIFACTS) {
    if (existsSync(path.join(outDir, artifact))) {
      present.push(artifact);
    } else {
      missing.push(artifact);
    }
  }

  if (present.length === 0) {
    issues.push({
      id: "output.not-generated",
      level: "warn",
      message: `no generated artifacts under "${outDir}"`,
      fix: "leadtype generate",
    });
    return { root: outDir, present, missing, stale: [] };
  }

  const inputPaths = [
    ...inspections.flatMap((inspection) => inspection.files),
    ...(loaded ? [loaded.path] : []),
  ];
  const newestInput = await newestMtime(inputPaths);
  const stale: string[] = [];
  for (const artifact of present) {
    const artifactPath = path.join(outDir, artifact);
    try {
      const stats = await stat(artifactPath);
      if (stats.mtimeMs < newestInput) {
        stale.push(artifact);
      }
    } catch {
      // Raced with a concurrent build; a missing file is not a stale one.
    }
  }
  if (stale.length > 0) {
    issues.push({
      id: "output.stale",
      level: "warn",
      message: `${stale.length} artifact${stale.length === 1 ? " is" : "s are"} older than the newest source file or the config`,
      fix: "leadtype generate",
    });
  }
  if (missing.length > 0) {
    issues.push({
      id: "output.missing-artifacts",
      level: "warn",
      message: `${missing.length} expected artifact${missing.length === 1 ? "" : "s"} absent: ${missing.join(", ")}`,
      fix: "leadtype generate",
    });
  }

  return { root: outDir, present, missing, stale };
}

const LEVEL_MARK = { error: "✗", warn: "!", info: "i" } as const;

function renderHuman(report: DoctorReport, srcDir: string): string {
  const lines: string[] = [];
  const rel = (target: string) => path.relative(srcDir, target) || ".";

  lines.push(
    "Config",
    report.config.path
      ? `  ${rel(report.config.path)}  (${report.config.mode})`
      : "  none found"
  );
  if (report.config.deprecations.length > 0) {
    lines.push(
      `  ${report.config.deprecations.length} deprecated field(s): ${report.config.deprecations
        .map((entry) => `${entry.field} → ${entry.replacement}`)
        .join(", ")}`
    );
  }

  if (report.sources.length > 0) {
    lines.push("", "Sources");
    for (const source of report.sources) {
      if (source.kind === "local") {
        lines.push(`  ${source.id}  local  → ${source.collections.join(", ")}`);
        continue;
      }
      const pin = source.refKind === "commit" ? "pinned" : "mutable";
      const synced = source.syncedCommit
        ? source.syncedCommit.slice(0, 7)
        : "not synced";
      lines.push(
        `  ${source.id}  ${source.repository}@${source.ref}  ${pin}  ${synced}  → ${source.collections.join(", ")}`
      );
    }
  }

  if (report.collections.length > 0) {
    lines.push("", "Collections");
    for (const collection of report.collections) {
      const pages =
        collection.pageCount === undefined
          ? "unreadable"
          : `${collection.pageCount} page(s)`;
      lines.push(
        `  ${collection.key}  ${collection.routePrefix}  ${pages}${
          collection.contentDir ? `  ${rel(collection.contentDir)}` : ""
        }`
      );
    }
  }

  if (report.navigation) {
    lines.push(
      "",
      "Navigation",
      `  ${report.navigation.origin}  ${report.navigation.routedPages} routed page(s)`,
      report.navigation.groups.length > 0
        ? `  sections: ${report.navigation.groups.join(", ")}`
        : "  sections: (none)"
    );
  }

  lines.push(
    "",
    "Output",
    `  ${rel(report.outputs.root)}  ${report.outputs.present.length} present, ${report.outputs.missing.length} missing, ${report.outputs.stale.length} stale`
  );

  const surfaces = report.integrations.surfaces;
  lines.push(
    "",
    "Integrations",
    `  framework: ${report.integrations.framework ?? "none detected"}`,
    `  surfaces:  ${surfaces.length > 0 ? surfaces.join(", ") : "(defaults)"}`
  );

  if (report.issues.length > 0) {
    lines.push("", "Findings");
    for (const issue of report.issues) {
      lines.push(`  ${LEVEL_MARK[issue.level]} [${issue.id}] ${issue.message}`);
      if (issue.owner) {
        lines.push(`      owner: ${issue.owner}`);
      }
      if (issue.fix) {
        lines.push(`      fix:   ${issue.fix}`);
      }
    }
  } else {
    lines.push("", "No findings.");
  }

  return `${lines.join("\n")}\n`;
}

function finish(
  io: DoctorIo,
  args: DoctorArgs,
  report: DoctorReport,
  srcDir: string
): number {
  if (args.json) {
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.stdout.write(renderHuman(report, srcDir));
  }
  return report.ok ? 0 : 1;
}
