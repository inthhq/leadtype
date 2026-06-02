import type { DocsArtifacts } from "../mcp/artifacts";
import {
  loadDocsArtifacts,
  resolveBundleArtifactsBase,
} from "../mcp/artifacts";
import { runStdioServer } from "../mcp/stdio";
import {
  DOCS_TOOL_NAMES,
  type DocsToolName,
  defineDocsTools,
} from "../mcp/tools";

export type McpCliIo = {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

export type McpCliArgs = {
  artifacts: string;
  package?: string;
  tools?: DocsToolName[];
  check: boolean;
  query?: string;
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
  --check             Exercise the tools once and print the result, then exit. No MCP client,
                      no SDK, no editor — the fastest way to confirm the server works.
  --query <q>         Query to run under --check (default: the product name)
  -h, --help          Show this help

Exit codes:
  0  Server ran and the client disconnected (or --check succeeded)
  1  Failed to load artifacts or start the server
  2  CLI usage error

Test without a client:
  leadtype mcp --check --query "your search"   # one-shot, no setup
  npx @modelcontextprotocol/inspector leadtype mcp --artifacts ./public   # full MCP client UI
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
  const args: McpCliArgs = { artifacts: "./public", check: false, help: false };
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
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--query") {
      args.query = readValue(argv, ++i, "--query");
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return args;
}

/** One-shot tool exercise: no MCP client, no SDK, no transport. */
async function runCheck(
  artifacts: DocsArtifacts,
  args: McpCliArgs,
  io: McpCliIo
): Promise<number> {
  const tools = defineDocsTools(artifacts, { tools: args.tools });
  const pages = artifacts.manifest.pages.length;
  io.stdout.write(
    `leadtype mcp --check\n  artifacts: ${artifacts.baseDir ?? args.artifacts} (${pages} pages)\n  tools: ${tools.map((t) => t.name).join(", ")}\n\n`
  );

  const query = args.query ?? artifacts.manifest.product.name;
  const search = tools.find((tool) => tool.name === "search-docs");
  if (search) {
    const result = await search.handler({ query, limit: 5 });
    const hits = result.isError
      ? []
      : (JSON.parse(result.content[0]?.text ?? "[]") as { urlPath: string }[]);
    const uniquePaths = [...new Set(hits.map((hit) => hit.urlPath))];
    io.stdout.write(
      `  search-docs(${JSON.stringify(query)}): ${hits.length} hit(s) across ${uniquePaths.length} page(s)\n`
    );
    for (const urlPath of uniquePaths) {
      io.stdout.write(`    • ${urlPath}\n`);
    }
    const getPage = tools.find((tool) => tool.name === "get-page");
    const top = hits[0];
    if (getPage && top) {
      const page = await getPage.handler({ urlPath: top.urlPath });
      const chars = page.isError ? 0 : (page.content[0]?.text.length ?? 0);
      io.stdout.write(
        `  get-page(${JSON.stringify(top.urlPath)}): ${chars} chars${page.isError ? " (error)" : ""}\n`
      );
    } else if (!top) {
      io.stdout.write(
        `    (no hits for "${query}" — try --query "<term in your docs>")\n`
      );
    }
  }
  io.stdout.write(
    `\nOK — the server would expose ${tools.length} tool(s) over ${pages} pages.\n`
  );
  return 0;
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
    if (args.check) {
      return await runCheck(artifacts, args, io);
    }
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
