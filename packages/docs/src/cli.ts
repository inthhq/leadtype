#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getGenerateUsage, runGenerateCommand } from "./cli/generate";
import { getLintUsage, runLintCommand } from "./lint/cli";

type CliIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

const MAIN_USAGE = `@inth/docs — docs pipeline tooling

Usage:
  @inth/docs <command> [options]

Commands:
  generate   Convert MDX, generate LLM files, and build search artifacts
  lint       Validate MDX frontmatter, meta.json, and docs links
  help       Show help

Run @inth/docs <command> --help for command-specific options.
`;

function commandUsage(command: string | undefined): string {
  if (command === "generate") {
    return getGenerateUsage();
  }
  if (command === "lint") {
    return getLintUsage();
  }
  return MAIN_USAGE;
}

export async function runCli(
  argv: string[],
  io: CliIo = { stderr: process.stderr, stdout: process.stdout }
): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "-h" || command === "--help") {
    io.stdout.write(MAIN_USAGE);
    return 0;
  }

  if (command === "help") {
    io.stdout.write(commandUsage(rest[0]));
    return 0;
  }

  if (command === "generate") {
    return await runGenerateCommand(rest, io);
  }

  if (command === "lint") {
    return await runLintCommand(rest, io);
  }

  io.stderr.write(`unknown command: ${command}\n\n${MAIN_USAGE}`);
  return 2;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(resolve(entry)).href : false;
}

if (isDirectRun()) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      process.stderr.write(`@inth/docs: ${String(error)}\n`);
      process.exit(1);
    });
}
