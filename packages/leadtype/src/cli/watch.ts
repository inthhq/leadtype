import { existsSync, type FSWatcher, statSync, watch } from "node:fs";
import path from "node:path";

const DEFAULT_DEBOUNCE_MS = 150;

export type WatchController = {
  close: () => void;
};

export type WatchInputsOptions = {
  /** Directories (watched recursively) and files to watch. */
  paths: string[];
  /**
   * Absolute path prefixes whose events are ignored — the output directory
   * (writes there would retrigger the build forever), caches, VCS internals.
   */
  ignorePaths?: string[];
  /** Quiet window before a batch of changes fires `onChange`. */
  debounceMs?: number;
  /** Called with the deduplicated changed paths after the quiet window. */
  onChange: (changedPaths: string[]) => void;
};

function isIgnored(filePath: string, ignorePrefixes: string[]): boolean {
  if (path.basename(filePath) === ".DS_Store") {
    return true;
  }
  const segments = filePath.split(path.sep);
  if (segments.includes(".git") || segments.includes("node_modules")) {
    return true;
  }
  return ignorePrefixes.some(
    (prefix) => filePath === prefix || filePath.startsWith(prefix + path.sep)
  );
}

/**
 * Watch generate inputs and fire a debounced callback on change.
 *
 * Uses `fs.watch` with `recursive: true` for directories — supported on
 * macOS, Windows, and Linux for the Node versions leadtype targets (>=22).
 * Files are watched via their parent directory so editors that replace the
 * file (write-temp-then-rename) keep triggering events.
 */
export function watchInputs(options: WatchInputsOptions): WatchController {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const ignorePrefixes = (options.ignorePaths ?? []).map((ignorePath) =>
    path.resolve(ignorePath)
  );
  const watchers: FSWatcher[] = [];
  const pendingChanges = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const flush = (): void => {
    timer = undefined;
    if (closed || pendingChanges.size === 0) {
      return;
    }
    const changed = Array.from(pendingChanges);
    pendingChanges.clear();
    options.onChange(changed);
  };

  const recordChange = (changedPath: string): void => {
    if (closed || isIgnored(changedPath, ignorePrefixes)) {
      return;
    }
    pendingChanges.add(changedPath);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(flush, debounceMs);
  };

  for (const rawPath of options.paths) {
    const watchPath = path.resolve(rawPath);
    if (!existsSync(watchPath)) {
      continue;
    }
    const isDirectory = statSync(watchPath).isDirectory();
    if (isDirectory) {
      const watcher = watch(
        watchPath,
        { persistent: true, recursive: true },
        (_event, filename) => {
          if (!filename) {
            // Overflow/unknown event — rebuild conservatively.
            recordChange(watchPath);
            return;
          }
          const changedPath = path.join(watchPath, filename);
          // macOS reports a change to the watched directory itself using the
          // directory's own basename; the real inner-path event follows, so
          // this one is pure noise (and would dodge ignore prefixes).
          if (
            filename === path.basename(watchPath) &&
            !existsSync(changedPath)
          ) {
            return;
          }
          recordChange(changedPath);
        }
      );
      watchers.push(watcher);
      continue;
    }
    const fileName = path.basename(watchPath);
    const watcher = watch(
      path.dirname(watchPath),
      { persistent: true },
      (_event, filename) => {
        if (!filename || filename === fileName) {
          recordChange(watchPath);
        }
      }
    );
    watchers.push(watcher);
  }

  return {
    close: () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}
