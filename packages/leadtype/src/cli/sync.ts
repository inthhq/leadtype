import path from "node:path";
import { loadLeadtypeConfig } from "../config/load";
import { type SyncMode, syncCollections } from "../sync/sync";

export type SyncCliIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

export type SyncCliArgs = {
  srcDir: string;
  mode: SyncMode;
  repoFilter?: string;
  help: boolean;
};

const SYNC_USAGE = `leadtype sync — clone or refresh remote sources declared by collections

Usage:
  leadtype sync [options]

Options:
  --src <dir>      Project root containing leadtype.config.{ts,js,mjs,cjs} (default: .)
  --refresh        Force fast-forward (or re-clone on drift) instead of leaving cached checkouts alone
  --offline        Fail if any source is missing or stale; never touch the network
  --repo <pat>     Only sync sources whose repository URL contains this substring
  -h, --help       Show this help

Exit codes:
  0  All targeted sources are ready
  1  Sync failed (clone error, --offline cache miss, …)
  2  CLI usage error or no collections configured
`;

export function getSyncUsage(): string {
  return SYNC_USAGE;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseSyncArgs(argv: string[]): SyncCliArgs {
  const args: SyncCliArgs = {
    srcDir: ".",
    mode: "auto",
    help: false,
  };
  let refreshSet = false;
  let offlineSet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--src") {
      args.srcDir = readValue(argv, ++i, "--src");
    } else if (arg === "--refresh") {
      refreshSet = true;
      args.mode = "refresh";
    } else if (arg === "--offline") {
      offlineSet = true;
      args.mode = "offline";
    } else if (arg === "--repo") {
      args.repoFilter = readValue(argv, ++i, "--repo");
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (refreshSet && offlineSet) {
    throw new Error("--refresh and --offline are mutually exclusive");
  }
  return args;
}

export async function runSyncCommand(
  argv: string[],
  io: SyncCliIo
): Promise<number> {
  let args: SyncCliArgs;
  try {
    args = parseSyncArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n\n${SYNC_USAGE}`);
    return 2;
  }

  if (args.help) {
    io.stdout.write(SYNC_USAGE);
    return 0;
  }

  const resolvedSrcDir = path.resolve(args.srcDir);
  const loaded = await loadLeadtypeConfig(resolvedSrcDir);
  if (!loaded) {
    io.stderr.write(
      `no leadtype.config.{ts,js,mjs,cjs} found in ${resolvedSrcDir}. ` +
        "`leadtype sync` is driven by a project-level config that declares collections.\n"
    );
    return 2;
  }

  const collections = loaded.config.collections;
  if (!collections || Object.keys(collections).length === 0) {
    io.stderr.write(
      `${loaded.path} has no \`collections\` to sync. ` +
        "Add at least one collection with a `repository` to use `leadtype sync`.\n"
    );
    return 2;
  }

  const configDir = path.dirname(loaded.path);
  try {
    const result = await syncCollections({
      mode: args.mode,
      configDir,
      collections,
      repoFilter: args.repoFilter,
    });

    if (result.sources.length === 0 && result.skipped.length === 0) {
      io.stdout.write(
        "No remote sources to sync (all collections are local).\n"
      );
      return 0;
    }

    const labels = {
      fresh: "cloned",
      refreshed: "refreshed",
      cached: "cached",
    } as const;
    // Report the resolved source id and its dependent collections, so one line
    // of output answers "what did this clone, and what reads from it?" — the
    // same ids the config, JSON output, and error messages use.
    const resolvedById = new Map(
      loaded.resolved.sources
        .filter((source) => source.kind === "git")
        .map((source) => [`${source.repository}#${source.ref}`, source])
    );
    const mutable: string[] = [];
    for (const entry of result.sources) {
      const label = labels[entry.status];
      const resolved = resolvedById.get(
        `${entry.source.repository}#${entry.source.ref}`
      );
      const dependents = (
        resolved?.collectionKeys ?? entry.source.collectionKeys
      ).join(", ");
      const id = resolved?.id ?? entry.source.repository;
      io.stdout.write(
        `${label}  ${id}  ${entry.source.repository}@${entry.source.ref}  ${entry.commit.slice(0, 7)}  → ${entry.source.cacheDir}\n` +
          `          collections: ${dependents}\n`
      );
      if (resolved?.kind === "git" && resolved.refKind === "mutable") {
        mutable.push(`${id} (${entry.source.ref})`);
      }
    }
    if (mutable.length > 0) {
      // A branch or moving tag resolves to a different commit tomorrow, which
      // is fine locally and a reproducibility hazard for a published build.
      io.stderr.write(
        `\nWarning: ${mutable.length} source${mutable.length === 1 ? " tracks a" : "s track"} mutable ref${mutable.length === 1 ? "" : "s"}: ${mutable.join(", ")}\n` +
          "  → Pin `ref` to a commit SHA or an immutable tag for reproducible published builds.\n"
      );
    }
    if (result.skipped.length > 0) {
      io.stdout.write(
        `\nSkipped ${result.skipped.length} source(s) excluded by --repo filter.\n`
      );
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n`);
    return 1;
  }
}
