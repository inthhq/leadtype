import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDisabledTelemetry,
  dispatchCommand,
  type CliCommand as HexbusCliCommand,
  type CliContext as HexbusCliContext,
  parseCliArgs,
} from "hexbus";
import { getDoctorUsage, runDoctorCommand } from "./cli/doctor";
import { getGenerateUsage, runGenerateCommand } from "./cli/generate";
import { getInitUsage, runInitCommand } from "./cli/init";
import { getMcpUsage, runMcpCommand } from "./cli/mcp";
import { getNavUsage, runNavCommand } from "./cli/nav";
import { getScoreUsage, runScoreCommand } from "./cli/score";
import { getSyncUsage, runSyncCommand } from "./cli/sync";
import { logger, setLogStreams } from "./internal/logger";
import { getLintUsage, runLintCommand } from "./lint/cli";

type CliIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

type LeadtypeCliContext = HexbusCliContext & {
  io: CliIo;
  state: {
    exitCode?: number;
  };
};

type LeadtypeCliCommand = HexbusCliCommand<LeadtypeCliContext>;

const MAIN_USAGE = `leadtype — docs pipeline tooling

Usage:
  leadtype <command> [options]

Commands:
  init       Scaffold an agent-ready docs integration for your framework
  doctor     Explain the resolved project — config, sources, routes, artifacts
  generate   Convert MDX, generate LLM files, and build search artifacts
  nav        Print the resolved navigation tree and report drift
  sync       Clone or refresh remote sources declared by collections
  lint       Validate MDX frontmatter, meta.json, and docs links
  mcp        Serve the generated docs to an MCP client over stdio
  score      Score the generated docs' agent readiness (mapped to the ora rubric)
  help       Show help

Run leadtype <command> --help for command-specific options.
`;

const commands: LeadtypeCliCommand[] = [
  {
    async action(context) {
      context.state.exitCode = await runSyncCommand(
        context.commandArgs,
        context.io
      );
    },
    description: "Acquire configured documentation sources.",
    hint: "Acquire configured documentation sources.",
    label: "Sync",
    name: "sync",
  },
  {
    async action(context) {
      context.state.exitCode = await runScoreCommand(
        context.commandArgs,
        context.io
      );
    },
    description: "Score generated docs.",
    hint: "Score generated docs.",
    label: "Score",
    name: "score",
  },
  {
    async action(context) {
      context.state.exitCode = await runNavCommand(
        context.commandArgs,
        context.io
      );
    },
    description: "Print navigation and report drift.",
    hint: "Print navigation and report drift.",
    label: "Nav",
    name: "nav",
  },
  {
    async action(context) {
      context.state.exitCode = await runMcpCommand(
        context.commandArgs,
        context.io
      );
    },
    description: "Serve generated docs over MCP.",
    hint: "Serve generated docs over MCP.",
    label: "Mcp",
    name: "mcp",
  },
  {
    async action(context) {
      context.state.exitCode = await runInitCommand(
        context.commandArgs,
        context.io
      );
    },
    description: "Scaffold a docs integration.",
    hint: "Scaffold a docs integration.",
    label: "Init",
    name: "init",
  },
  {
    async action(context) {
      context.state.exitCode = await runDoctorCommand(
        context.commandArgs,
        context.io
      );
    },
    description: "Explain the resolved project.",
    hint: "Explain the resolved project.",
    label: "Doctor",
    name: "doctor",
  },
  {
    async action(context) {
      context.state.exitCode = await runGenerateCommand(
        context.commandArgs,
        context.io
      );
    },
    description: "Convert MDX, generate LLM files, and build search artifacts.",
    hint: "Generate docs artifacts",
    label: "Generate",
    name: "generate",
  },
  {
    async action(context) {
      context.state.exitCode = await runLintCommand(
        context.commandArgs,
        context.io
      );
    },
    description: "Validate MDX frontmatter, meta.json, and docs links.",
    hint: "Validate docs content",
    label: "Lint",
    name: "lint",
  },
  {
    async action(context) {
      context.io.stdout.write(commandUsage(context.commandArgs[0]));
      context.state.exitCode = 0;
    },
    description: "Show help.",
    hint: "Show usage",
    label: "Help",
    name: "help",
  },
];

function commandUsage(command: string | undefined): string {
  if (command === "init") {
    return getInitUsage();
  }
  if (command === "doctor") {
    return getDoctorUsage();
  }
  if (command === "nav") {
    return getNavUsage();
  }
  if (command === "generate") {
    return getGenerateUsage();
  }
  if (command === "sync") {
    return getSyncUsage();
  }
  if (command === "lint") {
    return getLintUsage();
  }
  if (command === "mcp") {
    return getMcpUsage();
  }
  if (command === "score") {
    return getScoreUsage();
  }
  return MAIN_USAGE;
}

async function readPackageVersion(): Promise<string> {
  try {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { version?: unknown };
    return typeof packageJson.version === "string"
      ? packageJson.version
      : "unknown";
  } catch {
    return "unknown";
  }
}

function createLeadtypeContext(argv: string[], io: CliIo): LeadtypeCliContext {
  // Command parsers own every token after the command name, including flags
  // such as --config, --version and --force that Hexbus also recognizes.
  const parsed = parseCliArgs(argv.slice(0, 1), commands as HexbusCliCommand[]);
  const state: LeadtypeCliContext["state"] = {};
  return {
    commandArgs: parsed.commandName ? argv.slice(1) : argv,
    commandName: parsed.commandName,
    config: {
      getPathAliases: () => null,
      loadConfig: async () => null,
      requireConfig: async () => {
        throw new Error("leadtype CLI config is not available");
      },
    },
    confirm: async () => true,
    cwd: process.cwd(),
    error: {
      handleCancel(message): never {
        throw new Error(message ?? "Operation cancelled");
      },
      handleError(error): never {
        throw error instanceof Error ? error : new Error(String(error));
      },
    },
    flags: parsed.parsedFlags,
    framework: {
      framework: null,
      frameworkVersion: null,
      hasReact: false,
      pkg: null,
      reactVersion: null,
      tailwindVersion: null,
    },
    fs: {
      exists: async () => false,
      getPackageInfo: () => ({ name: "leadtype", version: "unknown" }),
      mkdir: async () => undefined,
      read: async () => "",
      write: async () => undefined,
    },
    io,
    logger: {
      debug: () => undefined,
      error: () => undefined,
      failed(message): never {
        throw new Error(String(message));
      },
      info: () => undefined,
      message: () => undefined,
      note: () => undefined,
      outro: () => undefined,
      step: () => undefined,
      success: () => undefined,
      warn: () => undefined,
    },
    packageManager: {
      addCommand: "npm install",
      execCommand: "npx",
      installCommand: "npm install",
      name: "npm",
      runCommand: "npm run",
    },
    projectRoot: process.cwd(),
    state,
    telemetry: createDisabledTelemetry(),
  };
}

export async function runCli(
  argv: string[],
  io: CliIo = { stderr: process.stderr, stdout: process.stdout }
): Promise<number> {
  setLogStreams(io);
  if (argv[0] === "--version") {
    io.stdout.write(`leadtype v${await readPackageVersion()}\n`);
    return 0;
  }

  if (!argv[0] || argv[0] === "--help" || argv[0] === "-h") {
    io.stdout.write(MAIN_USAGE);
    return 0;
  }

  if (argv[0].startsWith("-")) {
    io.stderr.write(`unknown command: ${argv[0]}\n\n${MAIN_USAGE}`);
    return 2;
  }

  const context = createLeadtypeContext(argv, io);
  const result = await dispatchCommand(context, commands, {
    noCommand: {
      async action() {
        io.stdout.write(MAIN_USAGE);
      },
      mode: "custom",
    },
    unknownCommand: {
      async action({ commandName }) {
        io.stderr.write(`unknown command: ${commandName}\n\n${MAIN_USAGE}`);
      },
    },
  });

  if (result.type === "command_failed") {
    throw result.error;
  }

  return result.type === "unknown_command" ? 2 : (context.state.exitCode ?? 0);
}

function resolveRealPath(filePath: string): string {
  try {
    return realpathSync.native(resolve(filePath));
  } catch {
    return resolve(filePath);
  }
}

export function isDirectRun(
  entry = process.argv[1],
  moduleUrl = import.meta.url
): boolean {
  return entry
    ? resolveRealPath(entry) === resolveRealPath(fileURLToPath(moduleUrl))
    : false;
}

if (isDirectRun()) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({
        human: { message, hint: "set DEBUG=1 to print the stack" },
        json: { event: "cli.fatal", fields: { message } },
      });
      if (process.env.DEBUG && error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
      process.exit(1);
    });
}
