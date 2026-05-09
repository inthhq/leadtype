import { type JSONSchema, type Tool, toolDefinition } from "@tanstack/ai";
import type { Bash } from "just-bash";
import {
  blockUnsafeDocsBashCommand,
  type CreateDocsBashOptions,
  createDocsBash,
  createDocsBashFileMap,
  createDocsBashInstructions,
  normalizeDocsBashRoot,
} from "./docs-bash";
import type { DocsSearchContentStore, DocsSearchIndex } from "./search";

const COMMAND_SCHEMA = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "Read-only bash command to run against the docs filesystem.",
    },
  },
  required: ["command"],
  additionalProperties: false,
} satisfies JSONSchema;

const READ_FILE_SCHEMA = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Absolute or docs-root-relative markdown file path to read.",
    },
  },
  required: ["path"],
  additionalProperties: false,
} satisfies JSONSchema;

const BASH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    stdout: { type: "string" },
    stderr: { type: "string" },
    exitCode: { type: "number" },
  },
  required: ["stdout", "stderr", "exitCode"],
  additionalProperties: false,
} satisfies JSONSchema;

const READ_FILE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
    notFound: { type: "boolean" },
  },
  required: ["path", "content"],
  additionalProperties: false,
} satisfies JSONSchema;

export type CreateDocsBashToolsOptions = CreateDocsBashOptions;

export type DocsTanStackBashResult = {
  docsBash: Bash;
  instructions: string;
  tools: Tool[];
};

function normalizeDocsFilePath(root: string, path: string): string {
  const withoutRoot = path.startsWith(root) ? path.slice(root.length) : path;
  const cleanPath = withoutRoot.replace(/^\/+/u, "");
  return `${root}/${cleanPath}`;
}

function blockedCommandResult() {
  return {
    exitCode: 1,
    stderr: "",
    stdout: "Blocked unsafe docs bash command.\n",
  };
}

function readCommandInput(args: unknown): string | undefined {
  return args &&
    typeof args === "object" &&
    "command" in args &&
    typeof args.command === "string"
    ? args.command
    : undefined;
}

function readPathInput(args: unknown): string | undefined {
  return args &&
    typeof args === "object" &&
    "path" in args &&
    typeof args.path === "string"
    ? args.path
    : undefined;
}

export function createDocsBashTools(
  index: DocsSearchIndex,
  content?: DocsSearchContentStore,
  options: CreateDocsBashToolsOptions = {}
): DocsTanStackBashResult {
  const root = normalizeDocsBashRoot(options.root);
  const docsBash = createDocsBash(index, content, {
    ...options,
    root,
  });
  const fileMap = createDocsBashFileMap(index, content, { root });
  const instructions = createDocsBashInstructions(root);
  const bashTool = toolDefinition({
    name: "docs_bash",
    description:
      "Run a read-only bash command against the mounted documentation filesystem.",
    inputSchema: COMMAND_SCHEMA,
    outputSchema: BASH_OUTPUT_SCHEMA,
  }).server(async (args) => {
    const command = readCommandInput(args);
    if (!command) {
      return {
        exitCode: 1,
        stderr: "Missing command.",
        stdout: "",
      };
    }
    const blockedCommand = blockUnsafeDocsBashCommand(command);
    if (blockedCommand !== undefined) {
      return blockedCommandResult();
    }
    return docsBash.exec(command);
  });
  const readFileTool = toolDefinition({
    name: "docs_read_file",
    description:
      "Read one exact file from the mounted documentation filesystem.",
    inputSchema: READ_FILE_SCHEMA,
    outputSchema: READ_FILE_OUTPUT_SCHEMA,
  }).server((args) => {
    const requestedPath = readPathInput(args);
    if (!requestedPath) {
      return {
        content: "",
        notFound: true,
        path: "",
      };
    }
    const path = normalizeDocsFilePath(root, requestedPath);
    const content = fileMap[path];
    return {
      content: content ?? "",
      ...(content === undefined ? { notFound: true } : {}),
      path,
    };
  });

  return {
    docsBash,
    instructions,
    tools: [bashTool, readFileTool],
  };
}
