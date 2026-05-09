import type { BashToolkit } from "bash-tool";
import type { Bash } from "just-bash";
import {
  blockUnsafeDocsBashCommand,
  type CreateDocsBashOptions,
  createDocsBash,
  createDocsBashInstructions,
  DEFAULT_DOCS_BASH_MAX_OUTPUT_LENGTH,
  normalizeDocsBashRoot,
} from "./docs-bash";
import type { DocsSearchContentStore, DocsSearchIndex } from "./search";

const BASH_TOOL_PACKAGE = "bash-tool";
const MISSING_MODULE_PATTERN =
  /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve module specifier/u;

export type CreateDocsBashToolOptions = CreateDocsBashOptions & {
  includeWriteFile?: boolean;
  maxOutputLength?: number;
};

export type DocsBashTools = Pick<BashToolkit["tools"], "bash" | "readFile"> &
  Partial<Pick<BashToolkit["tools"], "writeFile">>;

export type DocsBashToolResult = Omit<BashToolkit, "tools"> & {
  docsBash: Bash;
  instructions: string;
  tools: DocsBashTools;
};

function isMissingModuleError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return (
    code === "MODULE_NOT_FOUND" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    MISSING_MODULE_PATTERN.test(error.message)
  );
}

export async function createDocsBashTool(
  index: DocsSearchIndex,
  content?: DocsSearchContentStore,
  options: CreateDocsBashToolOptions = {}
): Promise<DocsBashToolResult> {
  let createBashTool: typeof import("bash-tool")["createBashTool"];
  try {
    const bashToolModule = (await import(
      /* @vite-ignore */ BASH_TOOL_PACKAGE
    )) as typeof import("bash-tool");
    createBashTool = bashToolModule.createBashTool;
  } catch (error) {
    if (isMissingModuleError(error)) {
      throw new Error(
        'createDocsBashTool requires "bash-tool" as an optional peer dependency. Install it with: bun add bash-tool',
        { cause: error }
      );
    }
    throw error;
  }
  const root = normalizeDocsBashRoot(options.root);
  const docsBash = createDocsBash(index, content, {
    ...options,
    root,
  });
  const instructions = createDocsBashInstructions(root);
  const toolkit = await createBashTool({
    destination: root,
    extraInstructions: instructions,
    maxOutputLength:
      options.maxOutputLength ?? DEFAULT_DOCS_BASH_MAX_OUTPUT_LENGTH,
    onBeforeBashCall: ({ command }) => {
      const blockedCommand = blockUnsafeDocsBashCommand(command);
      return blockedCommand === undefined
        ? undefined
        : { command: blockedCommand };
    },
    sandbox: docsBash,
  });
  const tools: DocsBashTools = {
    bash: toolkit.tools.bash,
    readFile: toolkit.tools.readFile,
  };
  if (options.includeWriteFile) {
    tools.writeFile = toolkit.tools.writeFile;
  }

  return {
    ...toolkit,
    docsBash,
    instructions,
    tools,
  };
}
