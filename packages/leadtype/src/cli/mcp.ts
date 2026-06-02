import {
  loadDocsArtifacts,
  resolveBundleArtifactsBase,
} from "../mcp/artifacts";
import { runStdioServer } from "../mcp/stdio";
import { DOCS_TOOL_NAMES, type DocsToolName } from "../mcp/tools";

export type McpCliIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

export type McpCliArgs = {
  artifacts: string;
  package?: string;
  tools?: DocsToolName[];
  help: boolean;
};

const MCP_USAGE = `leadtype mcp — run the docs MCP server (stdio) over generated artifacts

Usage:
  leadtype mcp [options]

Reads the artifacts produced by \`leadtype generate\` (search-index.json,
agent-readability.json, and the docs/*.md mirror) and serves them to a local MCP
client (Claude Desktop, Cursor, Cline) over stdio.

Options:
  --artifacts <dir>   Directory containing the generated \`docs/\` folder (default: ./public)
  --package <name>    Serve a dependency's bundled docs from node_modules/<name> instead
  --tools <list>      Comma-separated tools to expose (${DOCS_TOOL_NAMES.join(", ")});
                      default: search-docs,get-page
  -h, --help          Show this help

Exit codes:
  0  Server ran and the client disconnected
  1  Failed to load artifacts or start the server
  2  CLI usage error
`;

export function getMcpUsage(): string {
  return MCP_USAGE;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseToolList(value: string): DocsToolName[] {
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const allowed = new Set<string>(DOCS_TOOL_NAMES);
  for (const name of names) {
    if (!allowed.has(name)) {
      throw new Error(
        `unknown tool "${name}" (expected one of: ${DOCS_TOOL_NAMES.join(", ")})`
      );
    }
  }
  return names as DocsToolName[];
}

export function parseMcpArgs(argv: string[]): McpCliArgs {
  const args: McpCliArgs = { artifacts: "./public", help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--artifacts") {
      args.artifacts = readValue(argv, ++i, "--artifacts");
    } else if (arg === "--package") {
      args.package = readValue(argv, ++i, "--package");
    } else if (arg === "--tools") {
      args.tools = parseToolList(readValue(argv, ++i, "--tools"));
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return args;
}

export async function runMcpCommand(
  argv: string[],
  io: McpCliIo
): Promise<number> {
  let args: McpCliArgs;
  try {
    args = parseMcpArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n\n${MCP_USAGE}`);
    return 2;
  }

  if (args.help) {
    io.stdout.write(MCP_USAGE);
    return 0;
  }

  try {
    const base = args.package
      ? resolveBundleArtifactsBase(args.package)
      : args.artifacts;
    const artifacts = await loadDocsArtifacts({ artifacts: base });
    // stderr only — stdout is the stdio transport's JSON-RPC channel.
    io.stderr.write(
      `leadtype mcp: serving ${artifacts.manifest.pages.length} pages from ${artifacts.baseDir ?? base}\n`
    );
    await runStdioServer({ artifacts, tools: args.tools });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n`);
    return 1;
  }
}
