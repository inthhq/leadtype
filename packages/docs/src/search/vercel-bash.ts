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

export async function createDocsBashTool(
  index: DocsSearchIndex,
  content?: DocsSearchContentStore,
  options: CreateDocsBashToolOptions = {}
): Promise<DocsBashToolResult> {
  const { createBashTool } = (await import(
    /* @vite-ignore */ BASH_TOOL_PACKAGE
  )) as typeof import("bash-tool");
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
      return blockedCommand ? { command: blockedCommand } : undefined;
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
