import { createRequire } from "node:module";
import type { Root } from "mdast";
import type * as TS from "typescript";
import { visit } from "unist-util-visit";
import { parseAllDocuments as parseAllYamlDocuments } from "yaml";

/**
 * Parse-level snippet checks: every fenced code block with a known language
 * must at least parse. This is the cheap tier of snippet linting — no project
 * setup, no typechecking — and catches the broken-example class outright.
 *
 * Escape hatch: a twoslash-style `// @noErrors` line anywhere in a snippet
 * marks it as a deliberate fragment and skips checking (the same directive
 * the typecheck tier will honor).
 */

export type SnippetIssue = {
  rule: "snippet:parse";
  /** File-relative line of the offending code (fence-adjusted by callers). */
  line?: number;
  message: string;
};

const NO_ERRORS_DIRECTIVE_PATTERN = /^\s*\/\/\s*@noErrors\b/m;

/** Fence language → TypeScript virtual filename (drives script kind). */
const TS_SNIPPET_FILENAMES = new Map<string, string>([
  ["ts", "snippet.ts"],
  ["typescript", "snippet.ts"],
  ["mts", "snippet.mts"],
  ["cts", "snippet.cts"],
  ["tsx", "snippet.tsx"],
  ["js", "snippet.js"],
  ["javascript", "snippet.js"],
  ["mjs", "snippet.mjs"],
  ["cjs", "snippet.cjs"],
  ["jsx", "snippet.jsx"],
]);

const YAML_LANGS = new Set(["yaml", "yml"]);

// `typescript` is an optional peer dependency (same contract as the
// type-table extractor): when it isn't installed, TS/JS parse checks are
// skipped rather than failing the lint run.
let cachedTypeScript: typeof TS | null | undefined;

function loadTypeScript(): typeof TS | null {
  if (cachedTypeScript !== undefined) {
    return cachedTypeScript;
  }
  try {
    cachedTypeScript = createRequire(import.meta.url)(
      "typescript"
    ) as typeof TS;
  } catch {
    cachedTypeScript = null;
  }
  return cachedTypeScript;
}

const JSON_LINE_COMMENT_PATTERN = /^\s*\/\/.*$/gm;
const JSON_BLOCK_COMMENT_PATTERN = /\/\*[^*]*\*\//g;
const JSON_ELLIPSIS_LINE_PATTERN = /^\s*(?:\.\.\.|…),?\s*$/gm;
const JSON_TRAILING_COMMA_PATTERN = /,(\s*[}\]])/g;

/**
 * Minimal JSONC tolerance: whole-line // comments and trailing commas. Not a
 * full JSONC parser — inline comments after values still fail, which is fine
 * for a parse smoke test.
 */
function stripJsonComments(code: string): string {
  return code
    .replace(JSON_LINE_COMMENT_PATTERN, "")
    .replace(JSON_BLOCK_COMMENT_PATTERN, "")
    .replace(JSON_ELLIPSIS_LINE_PATTERN, "")
    .replace(JSON_TRAILING_COMMA_PATTERN, "$1");
}

type SnippetError = {
  /** 1-based line within the snippet, when known. */
  snippetLine?: number;
  message: string;
};

const SIGNATURE_FRAGMENT_PATTERN = /^[A-Za-z_$][\w$.]*\s*[(<]/;
const BARE_ELLIPSIS_LINE_PATTERN = /^(\s*)(?:\.\.\.|…)\s*$/gm;

/**
 * A line containing only `...` is the universal "rest omitted" idiom and
 * never valid code — treat it as the comment the author meant.
 */
function neutralizeEllipsisLines(code: string): string {
  return code.replace(BARE_ELLIPSIS_LINE_PATTERN, "$1// ...");
}

function firstTsError(
  ts: typeof TS,
  code: string,
  fileName: string
): TS.Diagnostic | undefined {
  const result = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
    },
  });
  return result.diagnostics?.find(
    (entry) => entry.category === ts.DiagnosticCategory.Error
  );
}

/**
 * Docs snippets are often deliberate fragments no annotation should be needed
 * for. When a snippet doesn't parse verbatim, retry it under the common docs
 * framings before reporting:
 *
 * - a bare object literal (`{ slug: "x" }`) as a parenthesized expression
 * - multiple sibling JSX elements wrapped in a fragment
 * - a bare call/type signature (`searchDocs(q: string): Result[]`) as a
 *   `declare function` declaration
 */
function fragmentAttempts(code: string, fileName: string): string[] {
  const attempts: string[] = [];
  const trimmed = code.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    attempts.push(`(${code});`);
    // A `{ name: Type; ... }` shape fence is a type literal, not a value.
    attempts.push(`type _Shape = ${code};`);
  }
  // A `key: value` property list (config-block excerpt) parses inside an
  // object literal.
  attempts.push(`({\n${code}\n});`);
  if (fileName.endsWith("x")) {
    attempts.push(`const _jsx = <>\n${code}\n</>;`);
  }
  // API-signature fences: every nonempty line is a bare signature.
  const lines = code.split("\n");
  if (
    lines.every(
      (line) =>
        line.trim().length === 0 || SIGNATURE_FRAGMENT_PATTERN.test(line.trim())
    )
  ) {
    attempts.push(
      lines
        .map((line) =>
          line.trim().length > 0 ? `declare function ${line}` : line
        )
        .join("\n")
    );
  }
  return attempts;
}

function checkTypeScriptSnippet(
  code: string,
  fileName: string
): SnippetError | null {
  const ts = loadTypeScript();
  if (!ts) {
    return null;
  }
  const preprocessed = neutralizeEllipsisLines(code);
  const diagnostic = firstTsError(ts, preprocessed, fileName);
  if (!diagnostic) {
    return null;
  }
  for (const attempt of fragmentAttempts(preprocessed, fileName)) {
    if (!firstTsError(ts, attempt, fileName)) {
      return null;
    }
  }
  const snippetLine =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
      : undefined;
  return {
    snippetLine,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  };
}

function checkSnippet(lang: string, code: string): SnippetError | null {
  const tsFileName = TS_SNIPPET_FILENAMES.get(lang);
  if (tsFileName) {
    return checkTypeScriptSnippet(code, tsFileName);
  }
  if (lang === "json" || lang === "jsonc") {
    try {
      JSON.parse(code);
      return null;
    } catch (error) {
      // JSON-with-comments is the pervasive docs idiom for config files
      // (tsconfig, editor settings) — accept it before reporting. `jsonc`
      // fences take the same path, so they are actually linted rather than
      // skipped.
      try {
        JSON.parse(stripJsonComments(code));
        return null;
      } catch {
        return {
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  if (YAML_LANGS.has(lang)) {
    try {
      // Multi-document sources (frontmatter examples, k8s-style docs) are
      // valid YAML streams.
      for (const doc of parseAllYamlDocuments(code)) {
        if (doc.errors.length > 0) {
          throw doc.errors[0];
        }
      }
      return null;
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return null;
}

/** Fence values present in a tree — the source pass's dedupe key. */
export function collectFenceValues(tree: Root | null): Set<string> {
  const values = new Set<string>();
  if (!tree) {
    return values;
  }
  visit(tree, "code", (node) => {
    const value = (node as { value?: unknown }).value;
    if (typeof value === "string") {
      values.add(value);
    }
  });
  return values;
}

/**
 * Walk fenced code blocks in a parsed markdown body and report snippets that
 * fail to parse in their declared language.
 */
export function collectSnippetIssues(
  tree: Root | null,
  options: {
    /**
     * Fence values already checked (from the source pass) — used by the
     * rendered-tree pass to report only fences contributed by includes.
     */
    skipValues?: ReadonlySet<string>;
    /** Suffix issues without line numbers (rendered-tree pass). */
    fromRendered?: boolean;
  } = {}
): SnippetIssue[] {
  if (!tree) {
    return [];
  }
  const issues: SnippetIssue[] = [];
  visit(tree, "code", (node) => {
    const code = node as {
      lang?: unknown;
      value?: unknown;
      position?: { start?: { line?: number } };
    };
    const lang =
      typeof code.lang === "string" ? code.lang.trim().toLowerCase() : "";
    const value = typeof code.value === "string" ? code.value : "";
    if (!lang || value.trim().length === 0) {
      return;
    }
    if (options.skipValues?.has(value)) {
      return;
    }
    if (NO_ERRORS_DIRECTIVE_PATTERN.test(value)) {
      return;
    }
    const failure = checkSnippet(lang, value);
    if (!failure) {
      return;
    }
    const fenceLine = code.position?.start?.line;
    // Snippet content starts on the line after the opening fence.
    let line: number | undefined;
    if (!options.fromRendered) {
      line =
        fenceLine !== undefined && failure.snippetLine !== undefined
          ? fenceLine + failure.snippetLine
          : fenceLine;
    }
    const origin = options.fromRendered ? " (from an included file)" : "";
    issues.push({
      rule: "snippet:parse",
      line,
      message: `\`${lang}\` snippet${origin} does not parse: ${failure.message} — fix it or mark a deliberate fragment with \`// @noErrors\``,
    });
  });
  return issues;
}
