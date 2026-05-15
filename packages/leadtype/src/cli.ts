import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CliFlag,
  createDisabledTelemetry,
  dispatchCommand,
  type CliCommand as HexbusCliCommand,
  type CliContext as HexbusCliContext,
  parseCliArgs,
} from "hexbus";
import { getGenerateUsage, runGenerateCommand } from "./cli/generate";
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
  generate   Convert MDX, generate LLM files, and build search artifacts
  lint       Validate MDX frontmatter, meta.json, and docs links
  help       Show help

Run leadtype <command> --help for command-specific options.
`;

const globalFlags: CliFlag[] = [
  {
    description: "Show version",
    expectsValue: false,
    names: ["--version"],
    type: "special",
  },
];

const COMMAND_LOCAL_VERSION_FLAGS = {
  "--version": "__leadtype_command_long_version_flag__",
  "-v": "__leadtype_command_short_version_flag__",
} as const;
const VERSION_FLAG_SENTINELS = new Map<string, string>(
  Object.entries(COMMAND_LOCAL_VERSION_FLAGS).map(([flag, sentinel]) => [
    sentinel,
    flag,
  ])
);

const commands: LeadtypeCliCommand[] = [
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
  if (command === "generate") {
    return getGenerateUsage();
  }
  if (command === "lint") {
    return getLintUsage();
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
  const parserArgv = preserveCommandLocalVersionFlags(argv);
  const parsed = parseCliArgs(
    parserArgv,
    commands as HexbusCliCommand[],
    globalFlags
  );
  const state: LeadtypeCliContext["state"] = {};
  return {
    commandArgs: parsed.commandArgs.map(restoreVersionFlag),
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

function preserveCommandLocalVersionFlags(argv: string[]): string[] {
  if (!commands.some((command) => command.name === argv[0])) {
    return argv;
  }
  return argv.map((arg, index) =>
    index > 0 && arg in COMMAND_LOCAL_VERSION_FLAGS
      ? COMMAND_LOCAL_VERSION_FLAGS[
          arg as keyof typeof COMMAND_LOCAL_VERSION_FLAGS
        ]
      : arg
  );
}

function restoreVersionFlag(arg: string): string {
  return VERSION_FLAG_SENTINELS.get(arg) ?? arg;
}

export async function runCli(
  argv: string[],
  io: CliIo = { stderr: process.stderr, stdout: process.stdout }
): Promise<number> {
  setLogStreams(io);
  const context = createLeadtypeContext(argv, io);

  if (context.flags.version === true) {
    io.stdout.write(`leadtype v${await readPackageVersion()}\n`);
    return 0;
  }

  if (
    context.flags.help === true &&
    context.commandName !== "help" &&
    (context.commandName || context.commandArgs.length === 0)
  ) {
    io.stdout.write(commandUsage(context.commandName));
    return 0;
  }

  if (!context.commandName && context.commandArgs.length === 0) {
    io.stdout.write(MAIN_USAGE);
    return 0;
  }

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
