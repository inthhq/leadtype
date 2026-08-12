import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DOCS_CONFIG_FILENAMES,
  LEADTYPE_CONFIG_FILENAMES,
} from "../config/inherit";
import { loadDocsConfigFromDir } from "../config/load";
import {
  BASE_URL_DEFAULT_SOURCE,
  normalizeAuthoredBaseUrl,
} from "../config/normalize";
import { runGenerateCommand } from "./generate";
import {
  buildPlan,
  defaultBaseUrl,
  type FrameworkPlan,
  GENERIC_DEV_BASE_URL,
  type InitFile,
  type InitFramework,
  isInitFramework,
  RECIPE_FRAMEWORKS,
  SUPPORTED_FRAMEWORKS,
  sharedFiles,
} from "./init-templates";

export type { InitFramework } from "./init-templates";

const DEFAULT_NAME = "My docs";
const DEFAULT_SUMMARY = "What this project does in one sentence.";
const RECIPE_URL =
  "https://leadtype.dev/docs/pipeline/use-the-source-primitive";
const WEBMCP_FLAG_DEPRECATION_MESSAGE =
  "--webmcp is deprecated as an init shortcut and will be removed in the next major version";
const WEBMCP_FLAG_DEPRECATION_HINT =
  "register leadtype/webmcp from your app code instead; the flag remains for compatibility";

const INIT_USAGE = `leadtype init — scaffold an agent-ready docs integration

Usage:
  leadtype init [options]

Options:
  -f, --framework <name>   Target framework: next | astro | nuxt | sveltekit.
                           Auto-detected from package.json when omitted.
      --dir <dir>          Project root to scaffold into (default: ".").
      --base-url <url>     Site base URL written once into docs/docs.config.ts
                           (default: per-framework dev URL).
      --name <name>        Product name written into docs.config.ts.
      --summary <text>     One-line product summary.
      --force              Overwrite files that already exist.
      --dry-run            Print the file plan without writing anything.
      --no-generate        Skip running \`leadtype generate\` after scaffolding.
      --webmcp             Deprecated: scaffold browser-side WebMCP registration.
      --json               Emit the file plan as JSON.
  -h, --help               Show help

Frameworks with bespoke setup (tanstack, fumadocs) are documented as recipes:
  ${RECIPE_URL}
`;

export type InitArgs = {
  baseUrl?: string;
  dir: string;
  dryRun: boolean;
  force: boolean;
  framework?: InitFramework;
  generate: boolean;
  help: boolean;
  json: boolean;
  name?: string;
  summary?: string;
  webmcp: boolean;
};

export type InitIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

export function getInitUsage(): string {
  return INIT_USAGE;
}

export function parseInitArgs(argv: string[]): InitArgs {
  const args: InitArgs = {
    dir: ".",
    dryRun: false,
    force: false,
    generate: true,
    help: false,
    json: false,
    webmcp: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`missing value for ${token}`);
      }
      index += 1;
      return value;
    };

    switch (token) {
      case "-f":
      case "--framework": {
        const value = next();
        if (!isInitFramework(value)) {
          throw new Error(
            `unsupported framework "${value}". Use one of: ${SUPPORTED_FRAMEWORKS.join(", ")}.`
          );
        }
        args.framework = value;
        break;
      }
      case "--dir":
        args.dir = next();
        break;
      case "--base-url":
        // Validated with the same rules the config loader applies to an
        // authored `baseUrl`, before any file is written — a bad value must
        // fail here as a usage error, not scaffold a project every later
        // command rejects.
        args.baseUrl = normalizeAuthoredBaseUrl(next(), "--base-url");
        break;
      case "--name":
        args.name = next();
        break;
      case "--summary":
        args.summary = next();
        break;
      case "--force":
        args.force = true;
        break;
      case "--dry-run":
        args.generate = false;
        args.dryRun = true;
        break;
      case "--no-generate":
        args.generate = false;
        break;
      case "--webmcp":
        args.webmcp = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`unknown option: ${token}`);
    }
  }

  return args;
}

/**
 * The root `leadtype.config.*` filename that would win config discovery, or
 * `null`. `generate` (via `loadLeadtypeConfig`) and the runtime read a root
 * config in preference to any `docs/docs.config.*`, so while one exists,
 * whatever init writes into `docs/docs.config.ts` is never read — with or
 * without `--force`.
 */
function findRootConfigFilename(projectRoot: string): string | null {
  return (
    LEADTYPE_CONFIG_FILENAMES.find((filename) =>
      existsSync(path.join(projectRoot, filename))
    ) ?? null
  );
}

/**
 * Whether the config `generate` would read declares a `baseUrl`. Inspected
 * with the same loader every other command uses — a regex over the authored
 * source would miss a spread or imported value. Best-effort by design: `null`
 * (no config found, or it failed to load) must stay silent, because a config
 * that cannot load fails loudly in the post-scaffold generate and every later
 * command — only a config that loads *successfully* without `baseUrl` says
 * anything about where URLs will resolve.
 */
async function existingConfigDeclaresBaseUrl(
  dir: string,
  filenames: readonly string[]
): Promise<boolean | null> {
  try {
    const loaded = await loadDocsConfigFromDir(dir, filenames);
    return loaded === null ? null : loaded.config.baseUrl !== undefined;
  } catch {
    return null;
  }
}

async function detectFramework(
  projectRoot: string
): Promise<InitFramework | null> {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return null;
  }
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return null;
  }
  if (deps.next) {
    return "next";
  }
  if (deps.astro) {
    return "astro";
  }
  if (deps.nuxt) {
    return "nuxt";
  }
  if (deps["@sveltejs/kit"]) {
    return "sveltekit";
  }
  return null;
}

type WriteOutcome = { action: "skipped" | "wrote"; path: string };

async function writeFiles(
  projectRoot: string,
  files: InitFile[],
  options: { dryRun: boolean; force: boolean }
): Promise<WriteOutcome[]> {
  const outcomes: WriteOutcome[] = [];
  for (const file of files) {
    const absolute = path.join(projectRoot, file.path);
    const exists = existsSync(absolute);
    if (exists && !options.force) {
      outcomes.push({ action: "skipped", path: file.path });
      continue;
    }
    if (!options.dryRun) {
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, file.contents, "utf8");
    }
    outcomes.push({ action: "wrote", path: file.path });
  }
  return outcomes;
}

const AGENTS_POINTER_START = "<!-- leadtype:start -->";
const AGENTS_POINTER_END = "<!-- leadtype:end -->";
// Lazy match between the markers so a re-run refreshes the block in place
// instead of stacking duplicates.
const AGENTS_POINTER_BLOCK_PATTERN =
  /<!-- leadtype:start -->[\s\S]*?<!-- leadtype:end -->/;
const TRAILING_WHITESPACE_PATTERN = /\s+$/;

type AgentsPointerAction = "appended" | "created" | "refreshed";

type AgentsPointerOutcome = {
  action: AgentsPointerAction;
  path: string;
};

function renderAgentsPointerBlock(): string {
  return [
    AGENTS_POINTER_START,
    "When using leadtype, or when writing, editing, reviewing, or restructuring",
    "docs in this project, read the bundled docs in",
    "`node_modules/leadtype/AGENTS.md` first — they're version-matched to the",
    "installed package and stay accurate as it updates.",
    AGENTS_POINTER_END,
  ].join("\n");
}

/**
 * Decide what writing the pointer would do to an `AGENTS.md` given its current
 * contents (`null` when the file is absent). Shared by the `--json` plan (which
 * predicts without writing) and the merge (which acts), so the two never drift.
 */
function decideAgentsPointerAction(
  existing: string | null
): AgentsPointerAction {
  if (existing === null) {
    return "created";
  }
  if (AGENTS_POINTER_BLOCK_PATTERN.test(existing)) {
    return "refreshed";
  }
  return "appended";
}

function renderMergedAgents(
  existing: string | null,
  action: AgentsPointerAction
): string {
  const block = renderAgentsPointerBlock();
  if (action === "created") {
    return `${block}\n`;
  }
  const current = existing ?? "";
  if (action === "refreshed") {
    return current.replace(AGENTS_POINTER_BLOCK_PATTERN, block);
  }
  const trimmed = current.replace(TRAILING_WHITESPACE_PATTERN, "");
  return `${trimmed}\n\n${block}\n`;
}

async function readAgentsFile(projectRoot: string): Promise<string | null> {
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    return null;
  }
  return await readFile(agentsPath, "utf8");
}

/**
 * Predict the pointer action without touching disk, for the `--json` plan.
 */
async function planAgentsPointer(
  projectRoot: string
): Promise<AgentsPointerOutcome> {
  const existing = await readAgentsFile(projectRoot);
  return { action: decideAgentsPointerAction(existing), path: "AGENTS.md" };
}

/**
 * Wire the consuming project's coding agent to leadtype's own bundled docs by
 * dropping the recommended root-`AGENTS.md` pointer (the pattern leadtype tells
 * its users to adopt — our evals show it lifts bundle-read from ~29% to
 * ~90–100%). Marker-delimited and additive: create the file if absent, refresh
 * the marked block in place if present, otherwise append — never overwrite a
 * user's existing content.
 */
async function mergeAgentsPointer(
  projectRoot: string,
  dryRun: boolean
): Promise<AgentsPointerOutcome> {
  const existing = await readAgentsFile(projectRoot);
  const action = decideAgentsPointerAction(existing);
  if (!dryRun) {
    const agentsPath = path.join(projectRoot, "AGENTS.md");
    await writeFile(agentsPath, renderMergedAgents(existing, action), "utf8");
  }
  return { action, path: "AGENTS.md" };
}

async function patchPackageJsonScript(
  projectRoot: string,
  outDir: string,
  dryRun: boolean
): Promise<boolean> {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return false;
  }
  try {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    if (pkg.scripts?.["docs:generate"]) {
      return false;
    }
    if (dryRun) {
      return true;
    }
    pkg.scripts = {
      ...pkg.scripts,
      // No --base-url: the scaffolded docs.config.ts carries `baseUrl`, and
      // repeating it here is exactly the drift the config field removes.
      "docs:generate": `leadtype generate --src . --out ${outDir}`,
    };
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

function renderNextSteps(
  framework: InitFramework,
  plan: FrameworkPlan,
  ranGenerate: boolean
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("Next steps:");
  lines.push(
    `  1. Ensure these are installed: leadtype, ${plan.deps.join(", ")}`
  );
  if (ranGenerate) {
    lines.push(`  2. Start your app: ${plan.devCommand}`);
    lines.push("  3. Visit /docs, /llms.txt, and /docs/index.md");
  } else {
    lines.push("  2. Generate agent artifacts: bun run docs:generate");
    lines.push(`  3. Start your app: ${plan.devCommand}`);
  }
  lines.push("");
  lines.push("Keep `docs:generate` in your build so artifacts stay in sync.");
  lines.push(`Reference: ${RECIPE_URL}#${framework}`);
  return lines.join("\n");
}

async function runPostScaffoldGenerate(
  projectRoot: string,
  plan: FrameworkPlan,
  io: InitIo
): Promise<boolean> {
  io.stdout.write("\nleadtype init: generating agent artifacts…\n");
  // `baseUrl` comes from the just-scaffolded docs/docs.config.ts.
  const generateCode = await runGenerateCommand(
    ["--src", projectRoot, "--out", path.join(projectRoot, plan.outDir)],
    io
  );
  if (generateCode !== 0) {
    io.stderr.write(
      "leadtype init: scaffolding succeeded but generate failed — run `leadtype generate` after installing dependencies.\n"
    );
    return false;
  }
  return true;
}

export async function runInitCommand(
  argv: string[],
  io: InitIo = { stderr: process.stderr, stdout: process.stdout }
): Promise<number> {
  let args: InitArgs;
  try {
    args = parseInitArgs(argv);
  } catch (error) {
    io.stderr.write(`${String(error)}\n\n${INIT_USAGE}`);
    return 2;
  }

  if (args.help) {
    io.stdout.write(INIT_USAGE);
    return 0;
  }

  if (args.webmcp) {
    io.stderr.write(
      `Warning: ${WEBMCP_FLAG_DEPRECATION_MESSAGE}\n  → ${WEBMCP_FLAG_DEPRECATION_HINT}\n`
    );
  }

  const projectRoot = path.resolve(args.dir);
  const dryRun = args.dryRun;

  const framework = args.framework ?? (await detectFramework(projectRoot));
  if (!framework) {
    io.stderr.write(
      `leadtype init: could not detect a framework. Pass --framework <${SUPPORTED_FRAMEWORKS.join(" | ")}>.\n` +
        `For ${RECIPE_FRAMEWORKS.join(" and ")}, follow the recipe at ${RECIPE_URL}\n`
    );
    return 2;
  }

  const name = args.name ?? DEFAULT_NAME;
  const summary = args.summary ?? DEFAULT_SUMMARY;
  const baseUrl = args.baseUrl ?? defaultBaseUrl(framework);

  // `--base-url` has exactly one destination: docs/docs.config.ts. The flag
  // is silently dropped when that file would be skipped (`writeFiles` keeps
  // it without `--force`) — or, `--force` or not, when a root
  // `leadtype.config.*` outranks it in config discovery, so the file the
  // value lands in is never the one `generate` reads.
  const rootConfigFilename = findRootConfigFilename(projectRoot);
  const docsConfigExists = existsSync(
    path.join(projectRoot, "docs", "docs.config.ts")
  );
  let baseUrlConflict: string | undefined;
  if (args.baseUrl !== undefined) {
    if (rootConfigFilename !== null) {
      baseUrlConflict = `${rootConfigFilename} takes precedence over docs/docs.config.ts, so --base-url would be ignored — init writes baseUrl only into docs/docs.config.ts, which is never read while the root config exists. Set baseUrl in ${rootConfigFilename} instead.`;
    } else if (!args.force && docsConfigExists) {
      baseUrlConflict =
        "docs/docs.config.ts already exists, so --base-url would be ignored — baseUrl lives only in that config. Set baseUrl there, or rerun with --force to overwrite it.";
    }
  }

  // Without --base-url, a kept config that omits `baseUrl` is not a mistake
  // init may refuse: leaving the field unset is exactly how a site picks up
  // its production URL from the deployment env vars `normalizeBaseUrl` falls
  // back to at generate time — which init cannot observe. So when the
  // framework's documented dev default (`:4321` for Astro, `:5173` for
  // SvelteKit) has nowhere to land, the rerun proceeds and only notes the two
  // resolutions. The winning config is judged, not blindly init's own
  // scaffold target: a root `leadtype.config.*` outranks docs/docs.config.ts
  // even when `--force` rewrites the latter.
  let baseUrlNote: string | undefined;
  if (args.baseUrl === undefined && baseUrl !== GENERIC_DEV_BASE_URL) {
    let winning: {
      dir: string;
      filenames: readonly string[];
      label: string;
    } | null = null;
    if (rootConfigFilename !== null) {
      winning = {
        dir: projectRoot,
        filenames: LEADTYPE_CONFIG_FILENAMES,
        label: rootConfigFilename,
      };
    } else if (!args.force && docsConfigExists) {
      winning = {
        dir: path.join(projectRoot, "docs"),
        filenames: DOCS_CONFIG_FILENAMES,
        label: "docs/docs.config.ts",
      };
    }
    if (
      winning !== null &&
      (await existingConfigDeclaresBaseUrl(winning.dir, winning.filenames)) ===
        false
    ) {
      baseUrlNote = `${winning.label} does not set baseUrl, so generated URLs resolve from ${BASE_URL_DEFAULT_SOURCE} at generate time — not the ${framework} dev default ${baseUrl}. That is the right setup when the deployment env supplies the URL; for a fixed URL, set baseUrl in ${winning.label}. \`leadtype doctor\` reports what resolves.`;
    }
  }

  // In write mode, refuse the conflict up front — before any file is written —
  // instead of silently dropping the flag. `--json` and `--dry-run` write
  // nothing, so the refusal's rationale does not apply: they keep their
  // documented plan output and carry the conflict inside it (a `warnings`
  // field in the JSON plan, a warning line after the dry-run plan) so the
  // preview is honest about what a real run would refuse. The note is
  // informational in every mode.
  if (baseUrlConflict !== undefined && !(args.json || dryRun)) {
    io.stderr.write(`leadtype init: ${baseUrlConflict}\n`);
    return 2;
  }

  const plan = buildPlan(framework, { webmcp: args.webmcp });
  const allFiles = [...sharedFiles(name, summary, baseUrl), ...plan.files];
  const baseUrlWarnings = [baseUrlConflict, baseUrlNote].filter(
    (warning): warning is string => warning !== undefined
  );

  if (args.json) {
    const agentsPointer = await planAgentsPointer(projectRoot);
    io.stdout.write(
      `${JSON.stringify(
        {
          framework,
          projectRoot,
          baseUrl,
          outDir: plan.outDir,
          files: [...allFiles.map((file) => file.path), "AGENTS.md"],
          // Surfaced separately so consumers can tell a fresh file from a
          // refresh of an existing user `AGENTS.md` — different blast radius.
          // The bare path stays in `files` for backwards compatibility.
          agentsPointer,
          dryRun,
          // Additive, and absent when there is nothing to say, so existing
          // consumers of the plan shape are untouched.
          ...(baseUrlWarnings.length === 0
            ? {}
            : { warnings: baseUrlWarnings }),
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  const outcomes = await writeFiles(projectRoot, allFiles, {
    dryRun,
    force: args.force,
  });
  const patched = await patchPackageJsonScript(
    projectRoot,
    plan.outDir,
    dryRun
  );
  const agentsPointer = await mergeAgentsPointer(projectRoot, dryRun);

  const prefix = dryRun ? "would scaffold" : "scaffolded";
  io.stdout.write(`leadtype init: ${prefix} ${framework} docs integration\n`);
  for (const outcome of outcomes) {
    const mark = outcome.action === "wrote" ? "+" : "~";
    const note = outcome.action === "skipped" ? " (exists, use --force)" : "";
    io.stdout.write(`  ${mark} ${outcome.path}${note}\n`);
  }
  if (patched) {
    io.stdout.write(
      `  ${dryRun ? "~" : "+"} package.json (added "docs:generate" script)\n`
    );
  }
  const agentsMark = dryRun || agentsPointer.action === "refreshed" ? "~" : "+";
  io.stdout.write(
    `  ${agentsMark} AGENTS.md (${agentsPointer.action} leadtype docs pointer)\n`
  );

  // Only reachable under --dry-run: write mode already refused on the
  // conflict, and --json returned its plan (conflict included) above. The
  // plan's skip marker alone would hide that a real run exits 2 here.
  if (baseUrlConflict !== undefined) {
    io.stderr.write(
      `leadtype init: warning: ${baseUrlConflict} A run without --dry-run refuses with exit 2.\n`
    );
  }
  // Informational in write mode and --dry-run alike (--json carried it in
  // `warnings`): the run proceeds either way.
  if (baseUrlNote !== undefined) {
    io.stderr.write(`leadtype init: note: ${baseUrlNote}\n`);
  }

  let ranGenerate = false;
  if (args.generate && !dryRun) {
    ranGenerate = await runPostScaffoldGenerate(projectRoot, plan, io);
  }

  io.stdout.write(`${renderNextSteps(framework, plan, ranGenerate)}\n`);
  return 0;
}
