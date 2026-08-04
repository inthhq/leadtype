/**
 * `leadtype nav` — print the resolved navigation tree and report drift.
 *
 * Config-owned navigation is the strength: one tree drives the sidebar,
 * `llms.txt`, `AGENTS.md`, the sitemap, and agent-readability metadata. The
 * cost is that on a large site you cannot see what you authored — an include
 * glob expands to pages you never named, a pin reorders a section, and a
 * template repeats across framework variants, so the tree you get is several
 * steps removed from the tree you wrote.
 *
 * This command closes that gap by showing the resolved tree and naming what
 * drifted from the content on disk. It is read-only: it never writes config,
 * moves content, or changes a public route.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { inferNavigationFromContent } from "../config/infer";
import { type NavigationOrigin, resolveProject } from "../config/project";
import { toDocsUrlPath } from "../internal/docs-url";
import { resolveDocsNavigation } from "../llm";
import type { DocsNavigation, DocsNavigationGroup } from "../llm/readability";

export type NavIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

export type NavArgs = {
  srcDir: string;
  docsDirs: string[];
  collection?: string;
  json: boolean;
  help: boolean;
};

export type NavDrift = {
  /** Pages on disk that no curated entry places. */
  unplaced: string[];
  /** Pages a curated entry names more than once. */
  duplicate: string[];
  /** Pages declaring a `group:` slug no config declares. */
  unknownGroup: { urlPath: string; slug: string }[];
};

export type NavTreeNode = {
  title: string;
  urlPath?: string;
  children: NavTreeNode[];
};

export type NavReport = {
  ok: boolean;
  collection: string;
  /** How the tree was produced. */
  origin: NavigationOrigin;
  pageCount: number;
  tree: NavTreeNode[];
  drift: NavDrift;
};

const NAV_USAGE = `leadtype nav — print the resolved navigation tree and report drift

Usage:
  leadtype nav [options]

Shows the tree your config actually resolves to — include globs expanded, pins
applied, templates instantiated — and reports pages that drifted from it.

Read-only: never writes config, moves content, or changes a public route.

Options:
  --src <dir>          Project root (default: .)
  --docs-dir <dir>     Docs source folder relative to --src (default: docs)
  --collection <key>   Inspect one collection of a multi-source project
  --json               Machine-readable tree and drift report
  -h, --help           Show this help

Exit codes:
  0  Resolved (drift is reported, not fatal)
  1  Navigation could not be resolved
  2  CLI usage error
`;

export function getNavUsage(): string {
  return NAV_USAGE;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseNavArgs(argv: string[]): NavArgs {
  const args: NavArgs = {
    srcDir: ".",
    docsDirs: [],
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
    } else if (arg === "--collection") {
      args.collection = readValue(argv, ++i, "--collection");
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg) {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return args;
}

function toTree(groups: DocsNavigationGroup[]): NavTreeNode[] {
  return groups.map((group) => ({
    title: group.title,
    children: [
      ...group.pages.map((page) => ({
        title: page.title,
        urlPath: page.urlPath,
        children: [],
      })),
      ...toTree(group.children),
    ],
  }));
}

function countPages(manifest: DocsNavigation): number {
  const walk = (groups: DocsNavigationGroup[]): number =>
    groups.reduce(
      (total, group) => total + group.pages.length + walk(group.children),
      0
    );
  return walk(manifest.groups) + manifest.ungrouped.length;
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
  const visit = (urlPath: string): void => {
    if (seen.has(urlPath)) {
      duplicates.add(urlPath);
      return;
    }
    seen.add(urlPath);
  };
  const walk = (groups: DocsNavigationGroup[]): void => {
    for (const group of groups) {
      for (const page of group.pages) {
        visit(page.urlPath);
      }
      walk(group.children);
    }
  };
  walk(manifest.groups);
  return [...duplicates].sort();
}

function renderTree(nodes: NavTreeNode[], depth = 0): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const indent = "  ".repeat(depth + 1);
    lines.push(
      node.urlPath
        ? `${indent}${node.title}  ${node.urlPath}`
        : `${indent}${node.title}`
    );
    lines.push(...renderTree(node.children, depth + 1));
  }
  return lines;
}

function renderHuman(report: NavReport): string {
  const lines: string[] = [
    `Navigation (${report.collection}, ${report.origin}, ${report.pageCount} page(s))`,
    ...renderTree(report.tree),
  ];
  if (report.drift.unplaced.length > 0) {
    lines.push(
      "",
      `Unplaced (${report.drift.unplaced.length}) — on disk, but no curated entry places them, so they fall back to the root:`,
      ...report.drift.unplaced.map((urlPath) => `  ${urlPath}`)
    );
  }
  if (report.drift.duplicate.length > 0) {
    lines.push(
      "",
      `Duplicated (${report.drift.duplicate.length}) — listed by more than one entry, so they appear twice in the sidebar and in llms.txt:`,
      ...report.drift.duplicate.map((urlPath) => `  ${urlPath}`)
    );
  }
  if (report.drift.unknownGroup.length > 0) {
    lines.push(
      "",
      `Unknown groups (${report.drift.unknownGroup.length}) — frontmatter names a group the config does not declare:`,
      ...report.drift.unknownGroup.map(
        (entry) => `  ${entry.urlPath}  group: ${entry.slug}`
      )
    );
  }
  if (
    report.drift.unplaced.length === 0 &&
    report.drift.duplicate.length === 0 &&
    report.drift.unknownGroup.length === 0
  ) {
    lines.push("", "No drift — every page on disk has a place in the tree.");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Report a tree derived straight from a content directory, for a project that
 * has no config at all. Nothing is curated, so there is no drift to report.
 */
async function reportInferredTree(input: {
  contentDir: string;
  json: boolean;
  io: NavIo;
}): Promise<number> {
  const { contentDir, json, io } = input;
  if (!existsSync(contentDir)) {
    io.stderr.write(
      `no docs config found, and no docs directory at "${contentDir}".\n  → Run \`leadtype init\`, or pass --docs-dir.\n`
    );
    return 1;
  }

  const derived = await inferNavigationFromContent(contentDir);
  const manifest = await resolveDocsNavigation({
    srcDir: path.dirname(contentDir),
    docsDirName: path.basename(contentDir),
    groups: [],
    nav: derived.navigation,
  });

  const report: NavReport = {
    ok: true,
    collection: "docs",
    origin: "inferred",
    pageCount: countPages(manifest),
    tree: toTree(manifest.groups),
    drift: { unplaced: [], duplicate: [], unknownGroup: [] },
  };
  io.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report)
  );
  return 0;
}

export async function runNavCommand(
  argv: string[],
  io: NavIo
): Promise<number> {
  let args: NavArgs;
  try {
    args = parseNavArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n\n${NAV_USAGE}`);
    return 2;
  }
  if (args.help) {
    io.stdout.write(NAV_USAGE);
    return 0;
  }

  const srcDir = path.resolve(args.srcDir);
  const docsDirNames = args.docsDirs.length > 0 ? args.docsDirs : ["docs"];
  const docsDirs = docsDirNames.map((dir) => path.resolve(srcDir, dir));

  try {
    const project = await resolveProject({ cwd: srcDir, docsDirs });

    // A project with no config is a supported state — `doctor` reports it as a
    // warning and keeps going — so infer a tree from disk rather than refusing.
    if (project.collections.length === 0) {
      return await reportInferredTree({
        contentDir: docsDirs[0] ?? srcDir,
        json: args.json,
        io,
      });
    }

    const collectionKey = args.collection ?? project.collections[0]?.key;
    const collection = project.collections.find(
      (entry) => entry.key === collectionKey
    );
    if (!collection) {
      io.stderr.write(
        `unknown collection "${args.collection ?? ""}". Declared: ${project.collections.map((entry) => entry.key).join(", ")}\n`
      );
      return 2;
    }

    // Environmental problems belong to the collection, not the tree: an
    // unsynced source has no content to resolve navigation against.
    const blocking = project.diagnostics.find(
      (entry) => entry.level === "error" && entry.collection === collection.key
    );
    if (!collection.contentDir) {
      io.stderr.write(
        `${blocking?.message ?? `collection "${collection.key}" has no readable content directory`}\n${
          blocking?.fix ? `  → ${blocking.fix}\n` : ""
        }`
      );
      return 1;
    }

    const contentDir = collection.contentDir;
    const origin = collection.navigationOrigin;
    const nav = collection.navigation;

    const mounts = [
      { pathPrefix: "", urlPrefix: collection.routePrefix },
      ...(collection.mounts ?? []),
    ];
    const manifest = await resolveDocsNavigation({
      srcDir: path.dirname(contentDir),
      docsDirName: path.basename(contentDir),
      groups: collection.groups ?? [],
      nav,
      mounts,
    });

    // Pages that fall back to `ungrouped` were not placed by a curated entry.
    // Root-level string entries are placements, so they are excluded; an
    // include glob at the root expands to a set this comparison cannot
    // reconstruct, so those configs report no unplaced pages rather than a
    // list of false positives.
    //
    // A tree is curated when someone wrote it — here or in the source repo it
    // was inherited from. `inherited` is the first origin carrying real root
    // entries, so treating it as uncurated would skip the glob guard and
    // report every glob-placed page as unplaced.
    const isCurated = origin === "explicit" || origin === "inherited";
    const rootEntries = isCurated ? (nav ?? []) : [];
    const rootIsLiteral =
      !isCurated ||
      rootEntries.every(
        (entry) => typeof entry === "string" || !("include" in entry)
      );
    const placedAtRoot = new Set(
      rootEntries
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => toDocsUrlPath(entry, mounts))
    );
    const unplaced = rootIsLiteral
      ? manifest.ungrouped
          .map((page) => page.urlPath)
          .filter((urlPath) => !placedAtRoot.has(urlPath))
      : [];

    const report: NavReport = {
      ok: true,
      collection: collection.key,
      origin,
      pageCount: countPages(manifest),
      tree: toTree(manifest.groups),
      drift: {
        unplaced,
        duplicate: findDuplicates(manifest),
        unknownGroup: manifest.unknown,
      },
    };

    io.stdout.write(
      args.json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report)
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n`);
    return 1;
  }
}
