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

import { resolveProjectNavigation } from "../config/navigation";
import {
  type NavigationOrigin,
  type ResolvedProject,
  type ResolvedProjectCollection,
  resolveProject,
} from "../config/project";
import {
  type ConfigValueOrigin,
  serializeResolvedConfig,
} from "../config/types";
import { normalizeBaseUrl } from "../internal/docs-url";
import type { LogCall } from "../internal/logger";
import type { DocsCollection, DocsConfig } from "../llm";
import { defaultCacheDir, readSyncManifest } from "../sync/sync";

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
    /**
     * What the config resolves `baseUrl` to in doctor's own environment:
     * `explicit` when the config authors it, `default` when it falls through
     * to deployment URL env vars or localhost. An explicit `--base-url`
     * passed to `generate` overrides this at generation time, and a build's
     * env fallbacks may differ from doctor's. Absent only when no config
     * resolved at all.
     */
    baseUrl?: { value: string; origin: ConfigValueOrigin };
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
    /** Where this collection's tree came from. */
    navigationOrigin: NavigationOrigin;
    provenance: Record<string, unknown>;
  }[];
  navigation: {
    /** Where the tree came from — `"mixed"` when collections disagree. */
    origin: NavigationOrigin | "mixed";
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

function enabledSurfaces(config: DocsConfig | null): string[] {
  const agents = config?.agents;
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
  if (config?.redirects) {
    surfaces.push("redirects");
  }
  if (config?.feeds?.length) {
    surfaces.push(`feeds:${config.feeds.length}`);
  }
  return surfaces;
}

/**
 * Load-time warnings (deprecations, unknown keys) formatted onto the injected
 * stderr — the same shape the process logger prints, but through `io`, so they
 * are capturable in tests and can never interleave with `--json` stdout.
 */
function writeLoadWarning(io: DoctorIo, call: LogCall): void {
  io.stderr.write(`Warning: ${call.human.message}\n`);
  if (call.human.hint) {
    io.stderr.write(`  → ${call.human.hint}\n`);
  }
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

/** Count the files a collection's include/exclude globs actually match. */
async function countCollectionPages(
  collection: ResolvedProjectCollection,
  authored: DocsCollection | undefined,
  issues: DoctorIssue[]
): Promise<number | undefined> {
  if (!collection.contentDir) {
    return;
  }
  const include =
    authored?.include && authored.include.length > 0
      ? authored.include
      : ["**/*.{md,mdx}"];
  const files = await fg(include, {
    absolute: true,
    cwd: collection.contentDir,
    // The staging glob semantics (`copySourceFiles`): dotfiles count, and a
    // bare-directory include stays literal rather than fanning out to
    // `dir/**` — so the page count reported here is the one `generate` stages.
    dot: true,
    expandDirectories: false,
    ignore: authored?.exclude ?? [],
    onlyFiles: true,
  });
  if (files.length === 0) {
    issues.push({
      id: "collection.no-matches",
      level: "warn",
      message: `collection "${collection.key}" matches no files in "${collection.contentDir}"`,
      owner:
        authored?.include && authored.include.length > 0
          ? `collections.${collection.key}.include`
          : `collections.${collection.key}.dir`,
    });
  }
  return files.length;
}

/**
 * Report on the navigation `resolveProjectNavigation` computes — the same
 * manifests, drift, and filtering `nav` reads, so the two commands cannot
 * disagree about the same project.
 */
async function inspectNavigation(input: {
  project: ResolvedProject;
  issues: DoctorIssue[];
}): Promise<DoctorReport["navigation"]> {
  const { project, issues } = input;
  const navigation = await resolveProjectNavigation(project);
  if (navigation.collections.length === 0 || navigation.origin === null) {
    return null;
  }

  // A tree that doesn't resolve is a finding, not a crash: CI gates on
  // doctor, so a pin typo has to come back as a report with a stable id and
  // the owning field, the way every other broken input does.
  for (const diagnostic of navigation.diagnostics) {
    issues.push({
      id: diagnostic.id,
      level: diagnostic.level,
      message: diagnostic.message,
      ...(diagnostic.owner ? { owner: diagnostic.owner } : {}),
      ...(diagnostic.fix ? { fix: diagnostic.fix } : {}),
    });
  }

  for (const collection of navigation.collections) {
    for (const unknown of collection.drift.unknownGroup) {
      issues.push({
        id: "nav.unknown-group",
        level: "error",
        message: `${unknown.urlPath} declares unknown group "${unknown.slug}"`,
        owner: `collections.${collection.collectionKey}.groups`,
        fix: "Add the group to `groups`, or fix the page's `group:` frontmatter.",
      });
    }
  }

  const unrepresented = navigation.unplaced;
  if (unrepresented.length > 0) {
    issues.push({
      id: "nav.unrepresented-page",
      level: "warn",
      message: `${unrepresented.length} page${unrepresented.length === 1 ? " is" : "s are"} absent from the curated navigation and fall back to the root: ${unrepresented.slice(0, 5).join(", ")}${unrepresented.length > 5 ? ", …" : ""}`,
      owner: "navigation",
      fix: "Place them in `navigation`, or remove the files.",
    });
  }

  return {
    origin: navigation.origin,
    groups: navigation.groups,
    routedPages: navigation.routedPages,
    unrepresentedPages: unrepresented,
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
  // Resolved against cwd, not `--src` — that is what `leadtype generate` does,
  // and the two commands taking the same flag differently is its own bug.
  const outDir = path.resolve(args.outDir);
  const issues: DoctorIssue[] = [];

  // One call does config discovery, source-owned inheritance, normalization,
  // inference, and per-collection content resolution. Doctor reports on the
  // result rather than re-deriving it — re-deriving is how this command and
  // `nav` both ended up skipping inheritance in the first place.
  let project: ResolvedProject;
  try {
    project = await resolveProject({
      cwd: srcDir,
      docsDirs: docsDirNames,
      warn: (call) => writeLoadWarning(io, call),
    });
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

  // Environmental problems are diagnostics, not exceptions — doctor's whole
  // job is to report them with the command that fixes each one.
  for (const diagnostic of project.diagnostics) {
    issues.push({
      id: diagnostic.id,
      level: diagnostic.level,
      message: diagnostic.message,
      ...(diagnostic.owner ? { owner: diagnostic.owner } : {}),
      ...(diagnostic.fix ? { fix: diagnostic.fix } : {}),
    });
  }

  const configDir = project.configDir;
  const resolved = project.resolved;

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
  for (const collection of project.collections) {
    const authored = project.config?.collections?.[collection.key];
    const pageCount = await countCollectionPages(collection, authored, issues);
    collections.push({
      key: collection.key,
      routePrefix: collection.routePrefix,
      ...(collection.contentDir ? { contentDir: collection.contentDir } : {}),
      ...(pageCount === undefined ? {} : { pageCount }),
      navigationOrigin: collection.navigationOrigin,
      provenance: collection.provenance,
    });
  }

  const sources: DoctorReport["sources"] = [];
  for (const source of project.sources) {
    if (source.kind === "local") {
      sources.push({
        id: source.id,
        kind: "local",
        collections: source.collectionKeys,
      });
      continue;
    }
    // Must be the exact path `sync` uses — `defaultCacheDir` runs the
    // repository URL through `repositorySlug`, so hand-joining it produced
    // `.leadtype/sources/https:/github.com/acme/acme.git@main`: a path that can
    // never exist, making every unpinned source report "not synced" while the
    // collection checks (which resolve correctly) reported nothing wrong.
    const cacheDir = path.resolve(
      configDir,
      source.cacheDir ?? defaultCacheDir(source.repository, source.ref)
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

  const navigation = await inspectNavigation({ project, issues });

  const outputs = await inspectOutputs({ outDir, project, issues });
  const framework = await detectFramework(srcDir);

  const report: DoctorReport = {
    ok: !issues.some((issue) => issue.level === "error"),
    config: {
      // Absent for an in-memory config too — a path that names nothing on
      // disk is worse than none.
      ...(project.configPath ? { path: project.configPath } : {}),
      mode: resolved?.mode ?? "none",
      deprecations: (resolved?.deprecations ?? []).map((entry) => ({
        field: entry.field,
        replacement: entry.replacement,
      })),
      // What the config resolves here and now: the authored field, else
      // deployment URL env vars / localhost in doctor's own process env. A
      // `generate --base-url` flag or the build's env can override this.
      ...(resolved
        ? {
            baseUrl: {
              value: normalizeBaseUrl(resolved.baseUrl),
              origin: resolved.provenance.baseUrl?.origin ?? "default",
            },
          }
        : {}),
      provenance: resolved ? serializeResolvedConfig(resolved).provenance : {},
    },
    sources,
    collections,
    navigation,
    outputs,
    integrations: {
      ...(framework ? { framework } : {}),
      surfaces: enabledSurfaces(project.config),
    },
    issues,
  };

  return finish(io, args, report, srcDir);
}

async function inspectOutputs(input: {
  outDir: string;
  project: ResolvedProject;
  issues: DoctorIssue[];
}): Promise<DoctorReport["outputs"]> {
  const { outDir, project, issues } = input;
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

  // Freshness is measured against every source file plus the config, so a
  // content edit or a config edit both mark artifacts stale.
  const sourceFiles = await Promise.all(
    project.collections
      .filter((collection) => collection.contentDir)
      .map((collection) =>
        fg("**/*.{md,mdx}", {
          absolute: true,
          cwd: collection.contentDir as string,
          onlyFiles: true,
        })
      )
  );
  const inputPaths = [
    ...sourceFiles.flat(),
    ...(project.configPath ? [project.configPath] : []),
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
  if (report.config.baseUrl) {
    lines.push(
      `  baseUrl: ${report.config.baseUrl.value}  (${report.config.baseUrl.origin})`
    );
  }
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
