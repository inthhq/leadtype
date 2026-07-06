#!/usr/bin/env node
import { existsSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { PluggableList } from "unified";
import {
  findNearestNodeModules,
  type LoadedDocsConfig,
  loadDocsConfig,
} from "../cli/generate";
import type { DocsPathMount } from "../internal/docs-url";
import { setLogFormat, setVerbose } from "../internal/logger";
import { getFlattenerNames } from "../internal/remark-phase";
import type { DocsConfig } from "../llm/llm";
import { readPathsLockfile } from "../redirects/node";
import type { DocsRedirect } from "../redirects/redirects";
import { resolveAllCollections } from "../sync/sync";
import { lintConfigLinks } from "./config-lint";
import { type ReporterFormat, renderReport } from "./reporters";
import {
  applyRuleOverrides,
  collectRouteSet,
  DEFAULT_IGNORE_GLOBS,
  type LintResult,
  type LintRuleOverrides,
  type LintSeverity,
  type LintViolation,
  lintDocs,
} from "./runner";

const DEFAULT_IGNORE_GLOBS_TEXT = DEFAULT_IGNORE_GLOBS.join(", ");
const STDOUT_FORMATS = new Set<ReporterFormat>(["github", "json"]);

type CliArgs = {
  /** Explicit source dir; when absent, docs-config discovery picks one. */
  srcDir?: string;
  changelogDir?: string;
  format: ReporterFormat;
  ignore: string[];
  unknownFieldSeverity: LintSeverity;
  /** True when --warn-unknown/--error-unknown was passed (beats config). */
  unknownFieldSeverityExplicit: boolean;
  maxWarnings: number;
  help: boolean;
  verbose: boolean;
  /** Force the external-link rule on (scheduled CI runs). */
  externalLinks: boolean;
};

export type LintCliIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

const USAGE = `leadtype lint — validate MDX frontmatter and meta.json against a schema

Usage:
  leadtype lint [srcDir] [options]

With no srcDir, lint discovers the docs config the same way generate does
(leadtype.config.* at the project root, then docs.config.* in ./docs or
./content) and lints that source tree with the config's mounts, schema,
ignore globs, and \`lint.rules\` severities applied. Curated config links
(navigation, llms sections, feeds, redirects) are validated too.

Options:
  --src <dir>              Source directory (default: from config discovery, else ./content)
  --changelog <dir>        Subdirectory that uses the changelog schema
  --format <fmt>           pretty | json | github (default: pretty)
  --ignore <glob>          Glob to skip (repeatable). Default: ${DEFAULT_IGNORE_GLOBS_TEXT}
  --warn-unknown           Unknown fields warn (default)
  --error-unknown          Unknown fields error
  --max-warnings <n>       Exit non-zero if warnings exceed n (default: Infinity)
  --external-links         Probe external http(s) URLs (for scheduled CI, not PR CI)
  -v, --verbose            Print extra progress events to stderr
  -h, --help               Show this help

Exit codes:
  0  No errors (warnings under --max-warnings)
  1  Errors present or warnings exceeded
  2  CLI usage error
`;

export function getLintUsage(): string {
  return USAGE;
}

export function parseLintArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    format: "pretty",
    ignore: [],
    unknownFieldSeverity: "warn",
    unknownFieldSeverityExplicit: false,
    maxWarnings: Number.POSITIVE_INFINITY,
    help: false,
    verbose: false,
    externalLinks: false,
  };
  let positional = 0;
  const readValue = (argv_: string[], index: number, flag: string): string => {
    const value = argv_[index];
    // Guard against flag-like tokens so `--src --format json` surfaces as a
    // usage error instead of silently consuming `--format` as the src dir.
    if (!value || value.startsWith("-")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--src") {
      args.srcDir = readValue(argv, ++i, "--src");
    } else if (arg === "--changelog") {
      args.changelogDir = readValue(argv, ++i, "--changelog");
    } else if (arg === "--format") {
      const value = readValue(argv, ++i, "--format");
      if (value !== "pretty" && value !== "json" && value !== "github") {
        throw new Error(`--format must be pretty|json|github, got ${value}`);
      }
      args.format = value;
    } else if (arg === "--ignore") {
      args.ignore.push(readValue(argv, ++i, "--ignore"));
    } else if (arg === "--warn-unknown") {
      args.unknownFieldSeverity = "warn";
      args.unknownFieldSeverityExplicit = true;
    } else if (arg === "--error-unknown") {
      args.unknownFieldSeverity = "error";
      args.unknownFieldSeverityExplicit = true;
    } else if (arg === "--max-warnings") {
      const value = readValue(argv, ++i, "--max-warnings");
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error("--max-warnings must be a non-negative integer");
      }
      args.maxWarnings = parsed;
    } else if (arg === "--external-links") {
      args.externalLinks = true;
    } else if (arg === "--verbose" || arg === "-v") {
      args.verbose = true;
    } else if (arg && !arg.startsWith("-")) {
      if (positional === 0) {
        args.srcDir = arg;
      } else {
        throw new Error(`unexpected positional argument: ${arg}`);
      }
      positional += 1;
    } else if (arg) {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return args;
}

function summarize(
  violations: LintViolation[],
  filesScanned: number
): LintResult {
  let errors = 0;
  let warnings = 0;
  for (const violation of violations) {
    if (violation.severity === "error") {
      errors += 1;
    } else {
      warnings += 1;
    }
  }
  return { violations, summary: { filesScanned, errors, warnings } };
}

/**
 * Routes under the OpenAPI `output` prefix only exist after generation, so
 * links into them are assumed valid rather than reported as missing.
 */
function openApiLinkPrefixes(openapi: DocsConfig["openapi"]): string[] {
  if (!openapi) {
    return [];
  }
  const inputs = Array.isArray(openapi) ? openapi : [openapi];
  // Mirrors the OpenAPI generator's defaults: pages live under
  // `<urlPrefix>/<output>` with urlPrefix defaulting to "/docs" and output
  // to "api".
  return inputs.map((input) => {
    if (typeof input === "string") {
      return "/docs/api";
    }
    const output = input.output?.trim().replace(/^\/+/, "") || "api";
    const rawPrefix = input.urlPrefix?.trim().replace(/\/+$/, "") || "/docs";
    const prefix = rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`;
    return prefix === "/" ? `/${output}` : `${prefix}/${output}`;
  });
}

export async function runLintCommand(
  argv: string[],
  io: LintCliIo = { stderr: process.stderr, stdout: process.stdout }
): Promise<number> {
  let args: CliArgs;
  try {
    args = parseLintArgs(argv);
  } catch (error) {
    io.stderr.write(`${String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    io.stdout.write(USAGE);
    return 0;
  }

  setLogFormat("human");
  setVerbose(false);
  if (args.format === "json") {
    setLogFormat("json");
  }
  if (args.verbose) {
    setVerbose(true);
  }

  // Config discovery mirrors `leadtype generate`: with an explicit --src,
  // look for leadtype.config.* at that dir (monorepo subpackage invocations)
  // and docs.config.* inside it; with no --src, discover from the cwd and
  // default the source dir to wherever the config lives.
  const cwd = process.cwd();
  let loaded: LoadedDocsConfig | null = null;
  let resolvedSrcDir: string;
  try {
    if (args.srcDir) {
      resolvedSrcDir = resolve(args.srcDir);
      loaded = await loadDocsConfig({
        cwd: resolvedSrcDir,
        docsDirs: [resolvedSrcDir],
      });
    } else {
      const candidates = [resolve(cwd, "docs"), resolve(cwd, "content")];
      loaded = await loadDocsConfig({ cwd, docsDirs: candidates });
      if (loaded && basename(loaded.path).startsWith("docs.config")) {
        resolvedSrcDir = dirname(loaded.path);
      } else if (loaded) {
        // Project-root leadtype.config.*: mirror generate's default docs dir
        // so lint and generate always target the same tree.
        resolvedSrcDir = resolve(cwd, "docs");
      } else {
        resolvedSrcDir =
          candidates.find((dir) => existsSync(dir)) ?? resolve(cwd, "content");
      }
    }
  } catch (error) {
    // A config that fails to load or validate is a lint failure in its own
    // right — report it instead of crashing.
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`leadtype lint: ${message}\n`);
    return 1;
  }

  const lintConfig = loaded?.config.lint;
  const collections = loaded?.config.collections;
  const effectiveIgnore =
    args.ignore.length > 0
      ? args.ignore
      : (lintConfig?.ignore ?? [...DEFAULT_IGNORE_GLOBS]);
  const unknownFieldSeverity = args.unknownFieldSeverityExplicit
    ? args.unknownFieldSeverity
    : (lintConfig?.unknownFieldSeverity ?? args.unknownFieldSeverity);
  const configRules = lintConfig?.rules as LintRuleOverrides | undefined;
  const mounts = loaded?.config.mounts;
  const assumeValidLinkPrefixes = openApiLinkPrefixes(loaded?.config.openapi);
  // External-link probing is opt-in: the --external-links flag (scheduled CI
  // runs) or a lint.rules["external-link"] severity in the config.
  const externalLinkRule = lintConfig?.rules?.["external-link"];
  const externalLinksEnabled =
    args.externalLinks ||
    (externalLinkRule !== undefined && externalLinkRule !== "off");
  // The flag is a force-on: a shared config's `"external-link": "off"` must
  // not silently swallow the violations of an explicit scheduled run.
  const rules =
    args.externalLinks && externalLinkRule === "off"
      ? Object.fromEntries(
          Object.entries(configRules ?? {}).filter(
            ([rule]) => rule !== "external-link"
          )
        )
      : configRules;
  const externalLinksNodeModules = findNearestNodeModules(resolvedSrcDir);
  const externalLinksOptions = externalLinksEnabled
    ? {
        ignore: lintConfig?.externalLinks?.ignore,
        ...(lintConfig?.externalLinks?.ttlHours === undefined
          ? {}
          : {
              ttlMs: lintConfig.externalLinks.ttlHours * 60 * 60 * 1000,
            }),
        ...(externalLinksNodeModules
          ? {
              cacheFile: resolve(
                externalLinksNodeModules,
                ".cache",
                "leadtype",
                "external-links.json"
              ),
            }
          : {}),
      }
    : undefined;

  // With redirect tracking enabled, an invalid-link to a renamed page reports
  // where it moved instead of a bare missing-route message.
  let redirects: DocsRedirect[] | undefined;
  if (loaded?.config.redirects) {
    const lockfile = await readPathsLockfile(
      resolve(
        dirname(loaded.path),
        loaded.config.redirects.lockfile ?? "paths.lock.json"
      )
    ).catch(() => null);
    redirects = lockfile?.redirects;
  }

  // Custom-flattener component names, so the `unflattened-component` rule
  // doesn't warn on components the project has actually wired a flattener for.
  const knownComponentSet = new Set<string>();
  const addFlattenerNames = (plugins?: PluggableList): void => {
    for (const entry of plugins ?? []) {
      for (const name of getFlattenerNames(entry)) {
        knownComponentSet.add(name);
      }
    }
  };
  addFlattenerNames(loaded?.config.flatteners);
  for (const collection of Object.values(collections ?? {})) {
    addFlattenerNames(collection.flatteners);
  }
  const knownComponents = [...knownComponentSet];

  let result: LintResult;
  if (loaded && collections && Object.keys(collections).length > 0) {
    const configDir = resolve(loaded.path, "..");
    const resolved = resolveAllCollections(collections, configDir);
    // Each collection publishes its whole tree under its urlPrefix, with the
    // collection's own mounts taking precedence for their subpaths (the
    // catch-all sorts last). Routes and prefixes are unioned across
    // collections so cross-collection links validate against real routes.
    const mountsFor = (entry: (typeof resolved)[number]): DocsPathMount[] => [
      ...(entry.collection.mounts ?? []),
      { pathPrefix: "", urlPrefix: entry.urlPrefix },
    ];
    const allMounts = resolved.flatMap(mountsFor);
    const routeSets = await Promise.all(
      resolved.map((entry) =>
        collectRouteSet({
          srcDir: entry.absoluteDir,
          ignore: effectiveIgnore,
          mounts: mountsFor(entry),
        })
      )
    );
    const combinedRouteSet = new Set(routeSets.flatMap((set) => [...set]));
    const combined: LintViolation[] = [];
    let filesScanned = 0;
    for (const entry of resolved) {
      io.stderr.write(
        `Linting collection [${entry.key}] at ${entry.absoluteDir}\n`
      );
      const each = await lintDocs({
        srcDir: entry.absoluteDir,
        ignore: effectiveIgnore,
        unknownFieldSeverity,
        knownComponents,
        mounts: allMounts,
        routeSet: combinedRouteSet,
        assumeValidLinkPrefixes,
        rules,
        ...(externalLinksOptions
          ? { externalLinks: externalLinksOptions }
          : {}),
        schemas: entry.collection.schema
          ? { frontmatter: entry.collection.schema }
          : undefined,
      });
      for (const violation of each.violations) {
        combined.push({
          ...violation,
          message: `[collection:${entry.key}] ${violation.message}`,
        });
      }
      filesScanned += each.summary.filesScanned;
    }
    result = summarize(combined, filesScanned);
  } else {
    // Computed once and shared with lintDocs so the config-link path doesn't
    // glob the tree a second time.
    const routeSet = loaded
      ? await collectRouteSet({
          srcDir: resolvedSrcDir,
          ignore: effectiveIgnore,
          mounts,
        })
      : undefined;
    result = await lintDocs({
      srcDir: resolvedSrcDir,
      changelogDir: args.changelogDir
        ? resolve(resolvedSrcDir, args.changelogDir)
        : undefined,
      ignore: effectiveIgnore,
      unknownFieldSeverity,
      knownComponents,
      mounts,
      assumeValidLinkPrefixes,
      rules,
      redirects,
      ...(externalLinksOptions ? { externalLinks: externalLinksOptions } : {}),
      ...(routeSet ? { routeSet } : {}),
      ...(loaded && lintConfig?.snippets?.typecheck
        ? { snippetTypecheck: { projectRoot: dirname(loaded.path) } }
        : {}),
    });

    // Config-owned links (navigation, llms sections, feeds, redirects) are
    // validated against the same route set as page links.
    if (loaded && routeSet) {
      const configViolations = applyRuleOverrides(
        await lintConfigLinks({
          config: loaded.config,
          configFile: relative(cwd, loaded.path) || loaded.path,
          srcDir: resolvedSrcDir,
          routeSet,
          assumeValidLinkPrefixes,
        }),
        rules
      );
      result = summarize(
        [...configViolations, ...result.violations],
        result.summary.filesScanned + 1
      );
    }
  }

  const output = renderReport(args.format, result);
  // Machine-readable formats go to stdout so they can be piped; the pretty
  // format goes to stderr so stdout stays clean when scripts mix formats.
  if (STDOUT_FORMATS.has(args.format)) {
    io.stdout.write(output);
  } else {
    io.stderr.write(output);
  }

  const exceedsWarnings = result.summary.warnings > args.maxWarnings;
  return result.summary.errors > 0 || exceedsWarnings ? 1 : 0;
}
