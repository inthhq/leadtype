/**
 * `--docs-dir` values, read one way everywhere.
 *
 * The flag is repeatable and each value is `<dir>` or `<dir>=<url-prefix>`.
 * `generate`, `doctor`, and `nav` all take it, so the parse lives here: when
 * `generate` owned it privately, the shared project resolver read the whole
 * `<dir>=<url-prefix>` string as a filesystem path and reported a documented
 * invocation as a missing directory.
 */

import path from "node:path";
import { normalizeUrlPrefix } from "./docs-url";

export function normalizeDocsSourceInput(input: string): string {
  return path.normalize(input).replace(/[/\\]+$/, "");
}

export function parseDocsSourceInput(input: string): {
  docsDir: string;
  urlPrefix?: string;
} {
  const separatorIndex = input.indexOf("=");
  if (separatorIndex === -1) {
    return { docsDir: input };
  }
  const docsDir = input.slice(0, separatorIndex);
  const urlPrefix = input.slice(separatorIndex + 1);
  if (!(docsDir.trim() && urlPrefix.trim())) {
    throw new Error(
      `Invalid --docs-dir value "${input}". Use <dir> or <dir>=<url-prefix>.`
    );
  }
  if (normalizeUrlPrefix(urlPrefix) === "/") {
    throw new Error(
      `Invalid --docs-dir value "${input}". URL prefix must not be the site root.`
    );
  }
  return { docsDir, urlPrefix };
}
