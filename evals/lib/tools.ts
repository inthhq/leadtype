import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { glob as fg } from "tinyglobby";
import { z } from "zod";
import type { ToolCall } from "./transcript";

const RESULT_SUMMARY_LIMIT = 200;
// Cap what a single `read` returns to the model. Real coding agents truncate
// large file reads (e.g. 2000 lines); without a cap, one minified bundle in
// `dist/` can blow the context window and turn a knowledge miss into a tooling
// crash — which would corrupt the treatment-vs-control comparison.
const READ_CHAR_LIMIT = 60_000;

function capRead(content: string): string {
  if (content.length <= READ_CHAR_LIMIT) {
    return content;
  }
  return `${content.slice(0, READ_CHAR_LIMIT)}\n…[truncated ${content.length - READ_CHAR_LIMIT} chars — file is larger than the read limit; use grep to find what you need]`;
}

/**
 * Resolve an agent-supplied path inside the eval tempdir, rejecting any
 * path that escapes the root. Treats absolute-looking paths as relative
 * to the tempdir (strips leading slashes) so the agent can't reach
 * `/etc/passwd` or `/Users/...` regardless of how it phrases the request.
 */
export function resolveScoped(tempDir: string, requested: string): string {
  if (typeof requested !== "string" || requested.length === 0) {
    throw new Error("path is required");
  }
  const cleaned = requested.replace(/^\/+/, "");
  const resolved = path.resolve(tempDir, cleaned);
  const root = path.resolve(tempDir);
  // Allow exactly the root; require everything else to start with `<root>/`.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path escape rejected: ${requested}`);
  }
  return resolved;
}

function summarize(value: string): string {
  return value.length > RESULT_SUMMARY_LIMIT
    ? `${value.slice(0, RESULT_SUMMARY_LIMIT)}…`
    : value;
}

type ToolCtx = {
  tempDir: string;
  transcript: ToolCall[];
  filesModified: Set<string>;
};

async function recorded<T>(
  ctx: ToolCtx,
  toolName: ToolCall["tool"],
  args: Record<string, unknown>,
  fn: () => Promise<T>,
  summarizeResult?: (value: T) => string
): Promise<T> {
  const start = Date.now();
  let result: T;
  let summary: string | undefined;
  let errorMessage: string | undefined;
  try {
    result = await fn();
    summary = summarizeResult ? summarizeResult(result) : undefined;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    ctx.transcript.push({
      tool: toolName,
      args,
      resultSummary: errorMessage ? `error: ${errorMessage}` : summary,
      isError: errorMessage !== undefined,
      durationMs: Date.now() - start,
    });
  }
  // biome-ignore lint/style/noNonNullAssertion: result is set unless the catch threw, and that throw rethrows
  return result!;
}

const NPM_SUBCOMMANDS = new Set(["pack", "install"]);
const NPM_ARG_PATTERN = /^-/;

const GREP_HIT_LIMIT = 200;
const TRUNCATION_NOTICE = `…(truncated at ${GREP_HIT_LIMIT} hits)`;
// A matched line in a minified bundle or `.map` file can be hundreds of KB on
// one line. Truncate each hit (ripgrep does the same with -M) so grepping
// `dist/` can't blow the context window.
const GREP_LINE_CHAR_LIMIT = 300;

function capGrepLine(line: string): string {
  return line.length > GREP_LINE_CHAR_LIMIT
    ? `${line.slice(0, GREP_LINE_CHAR_LIMIT)}…[long line truncated]`
    : line;
}

async function grepInScope(opts: {
  tempDir: string;
  targetPath: string;
  pattern: string;
  flags: string;
}): Promise<string> {
  const { tempDir, targetPath, pattern, flags } = opts;
  const target = resolveScoped(tempDir, targetPath);
  const re = new RegExp(pattern, flags);
  const files = await fg("**/*", {
    cwd: target,
    absolute: false,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  const hits: string[] = [];
  for (const file of files) {
    const truncated = await collectFileHits({
      tempDir,
      target,
      file,
      regex: re,
      hits,
    });
    if (truncated) {
      return capRead(hits.join("\n"));
    }
  }
  return hits.length === 0 ? "(no matches)" : capRead(hits.join("\n"));
}

async function collectFileHits(opts: {
  tempDir: string;
  target: string;
  file: string;
  regex: RegExp;
  hits: string[];
}): Promise<boolean> {
  const { tempDir, target, file, regex, hits } = opts;
  const abs = path.join(target, file);
  let content: string;
  try {
    content = await readFile(abs, "utf-8");
  } catch {
    // binary or unreadable file — skip silently.
    return false;
  }
  const rel = path.relative(tempDir, abs).replaceAll(path.sep, "/");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i] ?? "")) {
      hits.push(`${rel}:${i + 1}: ${capGrepLine(lines[i] ?? "")}`);
      if (hits.length >= GREP_HIT_LIMIT) {
        hits.push(TRUNCATION_NOTICE);
        return true;
      }
    }
  }
  return false;
}

export function scopedTools(ctx: ToolCtx) {
  const { tempDir } = ctx;
  return {
    read: tool({
      description:
        "Read the contents of a file inside the project. Path is resolved relative to the project root. Use this to inspect files like AGENTS.md, README.md, or any source file.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the project root"),
      }),
      execute: ({ path: requestedPath }) =>
        recorded(
          ctx,
          "read",
          { path: requestedPath },
          async () => {
            const target = resolveScoped(tempDir, requestedPath);
            return capRead(await readFile(target, "utf-8"));
          },
          summarize
        ),
    }),

    write: tool({
      description:
        "Write a file inside the project, creating parent directories as needed. Overwrites existing content.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the project root"),
        content: z.string().describe("Full file content to write"),
      }),
      execute: async ({ path: requestedPath, content }) =>
        recorded(
          ctx,
          "write",
          { path: requestedPath, contentLength: content.length },
          async () => {
            const target = resolveScoped(tempDir, requestedPath);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, content, "utf-8");
            ctx.filesModified.add(
              path.relative(tempDir, target).replaceAll(path.sep, "/")
            );
            return { bytesWritten: Buffer.byteLength(content, "utf-8") };
          },
          (r) => `wrote ${r.bytesWritten} bytes`
        ),
    }),

    list: tool({
      description:
        "List entries in a directory inside the project. Returns names with type (file or directory).",
      inputSchema: z.object({
        path: z
          .string()
          .default(".")
          .describe(
            "Directory path relative to the project root. Defaults to the root."
          ),
      }),
      execute: ({ path: requestedPath }) =>
        recorded(
          ctx,
          "list",
          { path: requestedPath },
          async () => {
            const target = resolveScoped(tempDir, requestedPath);
            const entries = await readdir(target, { withFileTypes: true });
            return capRead(
              entries
                .map(
                  (e) =>
                    `${e.isDirectory() ? "dir " : "file"}  ${e.name}${e.isDirectory() ? "/" : ""}`
                )
                .join("\n")
            );
          },
          summarize
        ),
    }),

    glob: tool({
      description:
        "Find files in the project matching a glob pattern. Patterns are evaluated against the project root.",
      inputSchema: z.object({
        pattern: z
          .string()
          .describe(
            "fast-glob pattern, e.g. '**/*.md', 'src/**/*.ts', 'node_modules/leadtype/docs/**/*.md'"
          ),
      }),
      execute: ({ pattern }) =>
        recorded(
          ctx,
          "glob",
          { pattern },
          async () => {
            const matches = await fg(pattern, {
              cwd: tempDir,
              absolute: false,
              dot: false,
              followSymbolicLinks: false,
              // Agent supplies the pattern; keep fast-glob semantics so a
              // bare directory name doesn't silently expand to `dir/**`.
              expandDirectories: false,
            });
            return capRead(matches.join("\n"));
          },
          summarize
        ),
    }),

    grep: tool({
      description:
        "Recursively search file contents for a regex inside the project. Returns matching files and lines.",
      inputSchema: z.object({
        pattern: z.string().describe("JavaScript regex source (no flags)"),
        path: z
          .string()
          .default(".")
          .describe(
            "Subdirectory or file to scope the search to. Defaults to the project root."
          ),
        flags: z
          .string()
          .default("i")
          .describe("Regex flags, e.g. 'i' for case-insensitive"),
      }),
      execute: ({ pattern, path: requestedPath, flags }) =>
        recorded(
          ctx,
          "grep",
          { pattern, path: requestedPath, flags },
          () =>
            grepInScope({
              tempDir,
              targetPath: requestedPath,
              pattern,
              flags,
            }),
          summarize
        ),
    }),

    npm: tool({
      description:
        "Run a strict-allowlisted npm subcommand inside the project. Only `pack` and `install` are allowed; arguments must be flag-form (start with '-'). Use this for `npm pack --dry-run` or `npm install`.",
      inputSchema: z.object({
        subcommand: z
          .enum(["pack", "install"])
          .describe("npm subcommand. Only `pack` and `install` are allowed."),
        args: z
          .array(z.string())
          .default([])
          .describe(
            "Additional arguments. Each must start with '-' (flag-form only)."
          ),
      }),
      execute: ({ subcommand, args }) =>
        recorded(
          ctx,
          "npm",
          { subcommand, args },
          async () => {
            if (!NPM_SUBCOMMANDS.has(subcommand)) {
              throw new Error(`npm subcommand not allowed: ${subcommand}`);
            }
            for (const arg of args) {
              if (!NPM_ARG_PATTERN.test(arg)) {
                throw new Error(
                  `npm arg must start with '-' (flag-form only): ${arg}`
                );
              }
            }
            return await new Promise<string>((resolveSpawn, rejectSpawn) => {
              const proc = spawn("npm", [subcommand, ...args], {
                cwd: tempDir,
                env: {
                  PATH: process.env.PATH ?? "/usr/bin:/bin",
                  NPM_CONFIG_LOGLEVEL: "error",
                  HOME: tempDir,
                },
              });
              let stdout = "";
              let stderr = "";
              proc.stdout.on("data", (b) => {
                stdout += b.toString();
              });
              proc.stderr.on("data", (b) => {
                stderr += b.toString();
              });
              proc.on("error", rejectSpawn);
              proc.on("close", (code) => {
                if (code === 0) {
                  resolveSpawn(stdout || stderr);
                } else {
                  rejectSpawn(
                    new Error(
                      `npm ${subcommand} exited ${code}\n${stderr || stdout}`
                    )
                  );
                }
              });
            });
          },
          summarize
        ),
    }),
  };
}
