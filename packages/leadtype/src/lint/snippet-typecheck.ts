import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Root } from "mdast";
import type * as TS from "typescript";
import { visit } from "unist-util-visit";
import { loadTypeScript } from "./snippet-lint";

/**
 * Opt-in snippet typechecking (`lint.snippets.typecheck`): `ts`/`tsx`
 * snippets are assembled into virtual modules and typechecked against the
 * consumer's real `node_modules`, so when a package's API changes, every doc
 * snippet still calling the old API fails lint — docs that can't rot.
 *
 * Scope is deliberately conservative: only snippets that *look like modules*
 * (they contain an `import` or `export` statement) are checked by default —
 * those are the copy-pasteable examples users run, and fragments rarely
 * import. A `// @check` line opts a fragment in; `// @noErrors` opts
 * anything out. Multi-file examples use twoslash's `// @filename: name.ts`
 * markers; every part typechecks in one shared virtual directory per
 * snippet, so parts can import each other.
 */

export type TypecheckSnippet = {
  /** Page file the fence lives in (docs-relative POSIX path). */
  file: string;
  /** 1-based line of the opening fence in the page, when known. */
  fenceLine?: number;
  /** Fence language (`ts` | `tsx` | variants). */
  lang: string;
  value: string;
};

export type SnippetTypecheckIssue = {
  rule: "snippet:types";
  file: string;
  /** Page-relative line, when mappable. */
  line?: number;
  message: string;
};

const MODULE_HINT_PATTERN = /^\s*(?:import|export)\b/m;
const CHECK_DIRECTIVE_PATTERN = /^\s*\/\/\s*@check\b/m;
const NO_ERRORS_DIRECTIVE_PATTERN = /^\s*\/\/\s*@noErrors\b/m;
const FILENAME_DIRECTIVE_PATTERN = /^\s*\/\/\s*@filename:\s*(\S+)\s*$/;
const TS_LANGS = new Set(["ts", "typescript", "mts", "cts", "tsx"]);

/**
 * Collect the fences on a page that qualify for typechecking: `ts`/`tsx`
 * language, module-shaped (or `// @check`), not `// @noErrors`.
 */
export function collectTypecheckSnippets(
  tree: Root | null,
  file: string,
  /** Offset from body-relative to file-relative lines (frontmatter length). */
  lineOffset = 0
): TypecheckSnippet[] {
  if (!tree) {
    return [];
  }
  const snippets: TypecheckSnippet[] = [];
  visit(tree, "code", (node) => {
    const code = node as {
      lang?: unknown;
      value?: unknown;
      position?: { start?: { line?: number } };
    };
    const lang =
      typeof code.lang === "string" ? code.lang.trim().toLowerCase() : "";
    const value = typeof code.value === "string" ? code.value : "";
    if (!TS_LANGS.has(lang) || value.trim().length === 0) {
      return;
    }
    if (NO_ERRORS_DIRECTIVE_PATTERN.test(value)) {
      return;
    }
    if (
      !(MODULE_HINT_PATTERN.test(value) || CHECK_DIRECTIVE_PATTERN.test(value))
    ) {
      return;
    }
    const bodyLine = code.position?.start?.line;
    snippets.push({
      file,
      // File-relative, so reported lines match every other content check.
      fenceLine: bodyLine === undefined ? undefined : bodyLine + lineOffset,
      lang,
      value,
    });
  });
  return snippets;
}

type VirtualFile = {
  /** Absolute virtual path handed to the compiler. */
  path: string;
  content: string;
  snippet: TypecheckSnippet;
  /** 1-based line in the snippet where this part's content starts. */
  snippetLineStart: number;
};

function extensionFor(lang: string): string {
  return lang === "tsx" ? ".tsx" : ".ts";
}

/**
 * Split a snippet on `// @filename:` markers into virtual files sharing one
 * directory, so multi-file examples can import each other. Content before
 * the first marker (or the whole snippet without markers) becomes the main
 * module.
 */
function toVirtualFiles(
  snippet: TypecheckSnippet,
  virtualDir: string
): VirtualFile[] {
  const lines = snippet.value.split("\n");
  const parts: { name: string | null; start: number; lines: string[] }[] = [
    { name: null, start: 1, lines: [] },
  ];
  for (const [index, line] of lines.entries()) {
    const marker = line.match(FILENAME_DIRECTIVE_PATTERN);
    if (marker?.[1]) {
      parts.push({ name: marker[1], start: index + 2, lines: [] });
      continue;
    }
    parts.at(-1)?.lines.push(line);
  }
  const files: VirtualFile[] = [];
  for (const part of parts) {
    if (part.lines.join("").trim().length === 0) {
      continue;
    }
    const filePath = part.name
      ? `${virtualDir}/${part.name.replace(/^\.\//, "")}`
      : `${virtualDir}/main${extensionFor(snippet.lang)}`;
    files.push({
      path: filePath,
      content: part.lines.join("\n"),
      snippet,
      snippetLineStart: part.start,
    });
  }
  return files;
}

function loadCompilerOptions(
  ts: typeof TS,
  projectRoot: string
): TS.CompilerOptions {
  let options: TS.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    esModuleInterop: true,
    resolveJsonModule: true,
  };
  const tsConfigPath = resolve(projectRoot, "tsconfig.json");
  if (existsSync(tsConfigPath)) {
    try {
      const configFile = ts.readConfigFile(tsConfigPath, (path) =>
        readFileSync(path, "utf-8")
      );
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        projectRoot
      );
      options = { ...options, ...parsed.options };
    } catch {
      // Fall back to defaults when the tsconfig doesn't parse.
    }
  }
  return { ...options, noEmit: true, isolatedModules: false };
}

export type TypecheckSnippetsOptions = {
  snippets: TypecheckSnippet[];
  /**
   * Directory whose `tsconfig.json` and `node_modules` ground the check —
   * usually the docs config's directory, so `import ... from "leadtype"`
   * resolves to the consumer's installed version.
   */
  projectRoot: string;
};

/**
 * Typecheck every qualifying snippet in one shared program (one compiler
 * setup regardless of snippet count). Returns issues mapped back to page
 * files and lines. No-ops when the optional `typescript` peer is missing.
 */
const CANNOT_FIND_MODULE_CODES = new Set([2307, 2792]);
// JSX environment errors: docs projects rarely install React/its types, so a
// tsx snippet shouldn't fail because `react/jsx-runtime` or
// `JSX.IntrinsicElements` is absent — element/props checking degrades while
// everything that resolves stays strict.
const JSX_ENVIRONMENT_MESSAGE_PATTERN =
  /requires the module path '[^']*jsx-runtime'|JSX\.IntrinsicElements/;
const MODULE_SPECIFIER_PATTERN =
  /(?:Cannot find module|its corresponding type declarations)[^']*'([^']+)'/;

function isUnresolvedPackageImport(
  ts: typeof TS,
  diagnostic: TS.Diagnostic
): boolean {
  if (!CANNOT_FIND_MODULE_CODES.has(diagnostic.code)) {
    return false;
  }
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  const specifier = message.match(MODULE_SPECIFIER_PATTERN)?.[1];
  if (!specifier) {
    return true;
  }
  return !(specifier.startsWith(".") || specifier.startsWith("/"));
}

export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function typecheckSnippets(
  options: TypecheckSnippetsOptions
): SnippetTypecheckIssue[] {
  const ts = loadTypeScript();
  if (!ts || options.snippets.length === 0) {
    return [];
  }
  const projectRoot = resolve(options.projectRoot);
  const virtualFiles = new Map<string, VirtualFile>();
  for (const [index, snippet] of options.snippets.entries()) {
    const virtualDir = `${projectRoot}/.leadtype-snippet-${index}`;
    for (const file of toVirtualFiles(snippet, virtualDir)) {
      virtualFiles.set(toPosixPath(file.path), file);
    }
  }

  const virtualDirs = new Set(
    [...virtualFiles.keys()].map((filePath) =>
      filePath.slice(0, filePath.lastIndexOf("/"))
    )
  );
  const compilerOptions = loadCompilerOptions(ts, projectRoot);
  const host = ts.createCompilerHost(compilerOptions, true);
  const baseFileExists = host.fileExists.bind(host);
  const baseReadFile = host.readFile.bind(host);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseDirectoryExists = host.directoryExists?.bind(host);
  host.fileExists = (fileName) =>
    virtualFiles.has(toPosixPath(fileName)) || baseFileExists(fileName);
  host.readFile = (fileName) =>
    virtualFiles.get(toPosixPath(fileName))?.content ?? baseReadFile(fileName);
  // Module resolution probes the containing directory; virtual dirs never
  // exist on disk, so sibling imports (`./helpers`) need this to resolve.
  host.directoryExists = (directoryName) =>
    virtualDirs.has(toPosixPath(directoryName)) ||
    (baseDirectoryExists?.(directoryName) ?? false);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const virtual = virtualFiles.get(toPosixPath(fileName));
    if (virtual) {
      return ts.createSourceFile(fileName, virtual.content, languageVersion);
    }
    return baseGetSourceFile(fileName, languageVersion, ...rest);
  };

  const program = ts.createProgram(
    [...virtualFiles.keys()],
    compilerOptions,
    host
  );
  const issues: SnippetTypecheckIssue[] = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) {
      continue;
    }
    // Docs snippets import from ecosystems the docs project doesn't install
    // (framework plugins, bundlers). An unresolvable *package* import
    // degrades to `any` (TS's own recovery) rather than failing — strict
    // checking applies to everything that does resolve, which is the point:
    // the documented package itself. Relative imports must always resolve.
    if (isUnresolvedPackageImport(ts, diagnostic)) {
      continue;
    }
    if (
      JSX_ENVIRONMENT_MESSAGE_PATTERN.test(
        ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
      )
    ) {
      continue;
    }
    const fileName = diagnostic.file?.fileName;
    const virtual = fileName
      ? virtualFiles.get(toPosixPath(fileName))
      : undefined;
    if (!virtual) {
      continue; // diagnostics from real project files aren't lint's business
    }
    const positionLine =
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line +
          1
        : undefined;
    const snippetLine =
      positionLine === undefined
        ? undefined
        : virtual.snippetLineStart + positionLine - 1;
    const line =
      virtual.snippet.fenceLine !== undefined && snippetLine !== undefined
        ? virtual.snippet.fenceLine + snippetLine
        : virtual.snippet.fenceLine;
    issues.push({
      rule: "snippet:types",
      file: virtual.snippet.file,
      line,
      message: `\`${virtual.snippet.lang}\` snippet fails typechecking: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    });
  }
  return issues;
}
