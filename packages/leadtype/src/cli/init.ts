import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runGenerateCommand } from "./generate";
import {
  buildPlan,
  defaultBaseUrl,
  type FrameworkPlan,
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
const RECIPE_URL = "https://leadtype.dev/docs/build/use-the-source-primitive";

const INIT_USAGE = `leadtype init — scaffold an agent-ready docs integration

Usage:
  leadtype init [options]

Options:
  -f, --framework <name>   Target framework: next | astro | nuxt | sveltekit.
                           Auto-detected from package.json when omitted.
      --dir <dir>          Project root to scaffold into (default: ".").
      --base-url <url>     Base URL for generated links (default: per-framework dev URL).
      --name <name>        Product name written into docs.config.ts.
      --summary <text>     One-line product summary.
      --force              Overwrite files that already exist.
      --dry-run            Print the file plan without writing anything.
      --no-generate        Skip running \`leadtype generate\` after scaffolding.
      --webmcp             Register generated docs as browser-side WebMCP tools.
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
        args.baseUrl = next();
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
    "When using leadtype or writing/editing docs, read the bundled docs in",
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
  baseUrl: string,
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
      "docs:generate": `leadtype generate --src . --out ${outDir} --base-url ${baseUrl}`,
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
  baseUrl: string,
  io: InitIo
): Promise<boolean> {
  io.stdout.write("\nleadtype init: generating agent artifacts…\n");
  const generateCode = await runGenerateCommand(
    [
      "--src",
      projectRoot,
      "--out",
      path.join(projectRoot, plan.outDir),
      "--base-url",
      baseUrl,
    ],
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

  const plan = buildPlan(framework, baseUrl, { webmcp: args.webmcp });
  const allFiles = [...sharedFiles(name, summary), ...plan.files];

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
    baseUrl,
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

  let ranGenerate = false;
  if (args.generate && !dryRun) {
    ranGenerate = await runPostScaffoldGenerate(projectRoot, plan, baseUrl, io);
  }

  io.stdout.write(`${renderNextSteps(framework, plan, ranGenerate)}\n`);
  return 0;
}
